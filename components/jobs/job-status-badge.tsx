import type { JobStatus } from "@/types";

const labels: Record<JobStatus, string> = {
  draft: "rascunho",
  queued: "fila",
  researching: "pesquisa",
  scripting: "roteiro",
  voice_generating: "voz",
  lip_syncing: "lip-sync",
  rendering: "render",
  review: "revisao",
  completed: "finalizado",
  failed: "falhou"
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <span className={`status-badge ${status}`}>{labels[status]}</span>;
}
