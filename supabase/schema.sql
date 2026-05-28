create extension if not exists pgcrypto;

do $$
begin
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
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.video_platform as enum ('tiktok', 'youtube', 'instagram', 'other');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.avatar_status as enum ('ready', 'disabled');
exception when duplicate_object then null;
end $$;

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
  id uuid primary key,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  image_path text not null,
  thumbnail_path text,
  voice_reference_path text,
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
  user_id uuid not null,
  avatar_id uuid not null references public.avatars(id) on delete restrict,
  source_video_id uuid references public.viral_videos(id) on delete set null,
  topic text not null,
  render_layout text not null default 'source_pip',
  status public.job_status not null default 'draft',
  script_text text,
  voice_provider text,
  audio_path text,
  lip_sync_video_path text,
  final_video_path text,
  error_message text,
  voice_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reaction_jobs
add column if not exists render_layout text not null default 'source_pip';

alter table public.reaction_jobs
add column if not exists voice_settings jsonb not null default '{}'::jsonb;

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
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

alter table if exists public.profiles drop constraint if exists profiles_id_fkey;
alter table if exists public.avatars drop constraint if exists avatars_user_id_fkey;
alter table if exists public.reaction_jobs drop constraint if exists reaction_jobs_user_id_fkey;
alter table if exists public.job_events drop constraint if exists job_events_user_id_fkey;

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
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "avatars_select_own" on public.avatars;
drop policy if exists "avatars_insert_own" on public.avatars;
drop policy if exists "avatars_update_own" on public.avatars;
drop policy if exists "viral_videos_select_authenticated" on public.viral_videos;
drop policy if exists "viral_videos_insert_authenticated" on public.viral_videos;
drop policy if exists "reaction_jobs_select_own" on public.reaction_jobs;
drop policy if exists "reaction_jobs_insert_own" on public.reaction_jobs;
drop policy if exists "reaction_jobs_update_own" on public.reaction_jobs;
drop policy if exists "reaction_jobs_delete_own" on public.reaction_jobs;
drop policy if exists "job_events_select_own" on public.job_events;
drop policy if exists "job_events_insert_own" on public.job_events;

drop policy if exists "profiles_public_workspace" on public.profiles;
create policy "profiles_public_workspace"
on public.profiles for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "avatars_public_workspace" on public.avatars;
create policy "avatars_public_workspace"
on public.avatars for all
to anon, authenticated
using (true)
with check (consent_accepted is true);

drop policy if exists "viral_videos_public_workspace" on public.viral_videos;
create policy "viral_videos_public_workspace"
on public.viral_videos for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "reaction_jobs_public_workspace" on public.reaction_jobs;
create policy "reaction_jobs_public_workspace"
on public.reaction_jobs for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "job_events_public_workspace" on public.job_events;
create policy "job_events_public_workspace"
on public.job_events for all
to anon, authenticated
using (true)
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to anon, authenticated;
grant select, insert, update, delete on public.avatars to anon, authenticated;
grant select, insert, update, delete on public.viral_videos to anon, authenticated;
grant select, insert, update, delete on public.reaction_jobs to anon, authenticated;
grant select, insert, update, delete on public.job_events to anon, authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/ogg']
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
values ('renders', 'renders', true, 524288000)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "avatars_storage_select_own" on storage.objects;
drop policy if exists "avatars_storage_insert_own" on storage.objects;
drop policy if exists "avatars_storage_update_own" on storage.objects;
drop policy if exists "job_assets_storage_own" on storage.objects;
drop policy if exists "project_storage_public_workspace" on storage.objects;
create policy "project_storage_public_workspace"
on storage.objects for all
to anon, authenticated
using (bucket_id in ('avatars', 'job-assets', 'renders'))
with check (bucket_id in ('avatars', 'job-assets', 'renders'));
