import Link from "next/link";
import { Plus } from "lucide-react";
import { JobList } from "@/components/jobs/job-list";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import type { JobStatus } from "@/types";

export type JobListItem = {
  id: string;
  topic: string;
  status: JobStatus;
  final_video_path: string | null;
  created_at: string;
  avatars: { name: string }[] | null;
};

export default async function JobsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reaction_jobs")
    .select("id, topic, status, final_video_path, created_at, avatars(name)")
    .order("created_at", { ascending: false });

  const jobs = (data ?? []) as unknown as JobListItem[];

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
