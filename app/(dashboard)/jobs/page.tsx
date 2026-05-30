export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus } from "lucide-react";
import { JobList } from "@/components/jobs/job-list";
import { EmptyState } from "@/components/ui/empty-state";
import { listLocalAvatars, listLocalJobs } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import type { JobStatus } from "@/types";


export type JobListItem = {
  id: string;
  topic: string;
  status: JobStatus;
  final_video_path: string | null;
  created_at: string;
  avatars: { name: string; image_path?: string }[] | { name: string; image_path?: string } | null;
  source_video_url?: string | null;
  viral_videos: { title: string; url: string; platform: string }[] | { title: string; url: string; platform: string } | null;
  audio_path?: string | null;
};

export default async function JobsPage() {
  const localAvatars = await listLocalAvatars();
  const localJobs = await listLocalJobs();
  let jobs: JobListItem[] = localJobs.map((job) => {
    const avatar = localAvatars.find((avatar) => avatar.id === job.avatar_id);
    return {
      ...job,
      avatars: avatar ? { name: avatar.name, image_path: avatar.image_path } : null,
      viral_videos: null,
      source_video_url: job.source_video_url ?? null,
      audio_path: job.audio_path
    };
  });

  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("reaction_jobs")
      .select("id, topic, status, final_video_path, created_at, avatars(name, image_path), audio_path, viral_videos(title, url, platform)")
      .eq("user_id", APP_WORKSPACE_ID)
      .order("created_at", { ascending: false });

    jobs = [...jobs, ...((data ?? []) as unknown as JobListItem[])];
  }
  return (
    <>
      <div className="title-row">
        <div className="section-title">
          <h1>Jobs</h1>
          <p>Lista dos videos de react gerados pela sua conta.</p>
        </div>
        <Link className="button" href="/jobs/new">
          <Plus size={18} /> Novo job
        </Link>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="Nenhum job ainda"
          description="Crie um job para iniciar o pipeline de pesquisa, roteiro, voz, lip-sync e render."
          actionHref="/jobs/new"
          actionLabel="Criar job"
        />
      ) : (
        <JobList jobs={jobs} />
      )}
    </>
  );
}
