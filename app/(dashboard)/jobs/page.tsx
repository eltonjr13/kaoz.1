export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus } from "lucide-react";
import { JobList } from "@/components/jobs/job-list";
import { EmptyState } from "@/components/ui/empty-state";
import { listLocalAvatars, listLocalJobEvents, listLocalJobs } from "@/lib/local-store";
import type { JobStatus } from "@/types";


export type JobListItem = {
  id: string;
  topic: string;
  status: JobStatus;
  final_video_path: string | null;
  created_at: string;
  updated_at: string;
  avatars: { name: string; image_path?: string }[] | { name: string; image_path?: string } | null;
  source_video_url?: string | null;
  viral_videos: { title: string; url: string; platform: string }[] | { title: string; url: string; platform: string } | null;
  audio_path?: string | null;
  latest_event_message?: string | null;
  latest_event_at?: string | null;
};

export default async function JobsPage() {
  const localAvatars = await listLocalAvatars();
  const localJobs = await listLocalJobs();
  const jobs: JobListItem[] = await Promise.all(localJobs.map(async (job) => {
    const avatar = localAvatars.find((avatar) => avatar.id === job.avatar_id);
    const latestEvent = (await listLocalJobEvents(job.id)).at(-1);
    return {
      ...job,
      avatars: avatar ? { name: avatar.name, image_path: avatar.image_path } : null,
      viral_videos: null,
      source_video_url: job.source_video_url ?? null,
      audio_path: job.audio_path,
      latest_event_message: latestEvent?.message ?? null,
      latest_event_at: latestEvent?.created_at ?? null
    };
  }));
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
