create extension if not exists pgcrypto;

create type public.job_status as enum (
  'draft',
  'queued',
  'researching',
  'scripting',
  'voice_generating',
  'lip_syncing',
  'rendering',
  'review',
  'completed',
  'failed'
);

create type public.video_platform as enum ('tiktok', 'youtube', 'instagram', 'other');
create type public.avatar_status as enum ('ready', 'disabled');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  image_path text not null,
  thumbnail_path text,
  consent_accepted boolean not null,
  consent_accepted_at timestamptz not null,
  status public.avatar_status not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avatars_consent_required check (consent_accepted is true)
);

create table if not exists public.viral_videos (
  id uuid primary key default gen_random_uuid(),
  platform public.video_platform not null default 'other',
  external_id text,
  title text not null,
  url text not null,
  thumbnail_url text,
  topic text not null,
  metrics jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);

create table if not exists public.reaction_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete restrict,
  source_video_id uuid references public.viral_videos(id) on delete set null,
  topic text not null,
  status public.job_status not null default 'draft',
  script_text text,
  voice_provider text,
  audio_path text,
  lip_sync_video_path text,
  final_video_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.reaction_jobs(id) on delete cascade,
  event_type text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists avatars_user_id_idx on public.avatars(user_id);
create index if not exists reaction_jobs_user_id_idx on public.reaction_jobs(user_id);
create index if not exists reaction_jobs_status_idx on public.reaction_jobs(status);
create index if not exists job_events_job_id_idx on public.job_events(job_id);
create index if not exists viral_videos_topic_idx on public.viral_videos(topic);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists avatars_set_updated_at on public.avatars;
create trigger avatars_set_updated_at
before update on public.avatars
for each row execute function public.set_updated_at();

drop trigger if exists reaction_jobs_set_updated_at on public.reaction_jobs;
create trigger reaction_jobs_set_updated_at
before update on public.reaction_jobs
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.ensure_job_avatar_owner()
returns trigger
language plpgsql
as $$
declare
  avatar_owner uuid;
  avatar_allowed boolean;
begin
  select user_id, consent_accepted
  into avatar_owner, avatar_allowed
  from public.avatars
  where id = new.avatar_id;

  if avatar_owner is null or avatar_owner <> new.user_id then
    raise exception 'avatar does not belong to user';
  end if;

  if avatar_allowed is not true then
    raise exception 'avatar consent is required';
  end if;

  return new;
end;
$$;

drop trigger if exists reaction_jobs_avatar_owner on public.reaction_jobs;
create trigger reaction_jobs_avatar_owner
before insert or update of user_id, avatar_id on public.reaction_jobs
for each row execute function public.ensure_job_avatar_owner();

create or replace function public.ensure_event_job_owner()
returns trigger
language plpgsql
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id
  from public.reaction_jobs
  where id = new.job_id;

  if owner_id is null or owner_id <> new.user_id then
    raise exception 'job event does not belong to user';
  end if;

  return new;
end;
$$;

drop trigger if exists job_events_job_owner on public.job_events;
create trigger job_events_job_owner
before insert or update of user_id, job_id on public.job_events
for each row execute function public.ensure_event_job_owner();

alter table public.profiles enable row level security;
alter table public.avatars enable row level security;
alter table public.viral_videos enable row level security;
alter table public.reaction_jobs enable row level security;
alter table public.job_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "avatars_select_own" on public.avatars;
create policy "avatars_select_own"
on public.avatars for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "avatars_insert_own" on public.avatars;
create policy "avatars_insert_own"
on public.avatars for insert
to authenticated
with check (auth.uid() = user_id and consent_accepted is true);

drop policy if exists "avatars_update_own" on public.avatars;
create policy "avatars_update_own"
on public.avatars for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id and consent_accepted is true);

drop policy if exists "viral_videos_select_authenticated" on public.viral_videos;
create policy "viral_videos_select_authenticated"
on public.viral_videos for select
to authenticated
using (true);

drop policy if exists "viral_videos_insert_authenticated" on public.viral_videos;
create policy "viral_videos_insert_authenticated"
on public.viral_videos for insert
to authenticated
with check (true);

grant select, insert on public.viral_videos to authenticated;

drop policy if exists "reaction_jobs_select_own" on public.reaction_jobs;
create policy "reaction_jobs_select_own"
on public.reaction_jobs for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "reaction_jobs_insert_own" on public.reaction_jobs;
create policy "reaction_jobs_insert_own"
on public.reaction_jobs for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "reaction_jobs_update_own" on public.reaction_jobs;
create policy "reaction_jobs_update_own"
on public.reaction_jobs for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "reaction_jobs_delete_own" on public.reaction_jobs;
create policy "reaction_jobs_delete_own"
on public.reaction_jobs for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "job_events_select_own" on public.job_events;
create policy "job_events_select_own"
on public.job_events for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "job_events_insert_own" on public.job_events;
create policy "job_events_insert_own"
on public.job_events for insert
to authenticated
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('job-assets', 'job-assets', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
values ('renders', 'renders', false, 524288000)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "avatars_storage_select_own" on storage.objects;
create policy "avatars_storage_select_own"
on storage.objects for select
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_storage_insert_own" on storage.objects;
create policy "avatars_storage_insert_own"
on storage.objects for insert
to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_storage_update_own" on storage.objects;
create policy "avatars_storage_update_own"
on storage.objects for update
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "job_assets_storage_own" on storage.objects;
create policy "job_assets_storage_own"
on storage.objects for all
to authenticated
using (bucket_id in ('job-assets', 'renders') and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id in ('job-assets', 'renders') and (storage.foldername(name))[1] = auth.uid()::text);
