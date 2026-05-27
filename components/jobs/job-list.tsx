import { Download } from "lucide-react";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import type { JobListItem } from "@/app/(dashboard)/jobs/page";

export function JobList({ jobs }: { jobs: JobListItem[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Assunto</th>
            <th>Avatar</th>
            <th>Status</th>
            <th>Criado em</th>
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.topic}</td>
              <td>{job.avatars?.[0]?.name ?? "Avatar removido"}</td>
              <td>
                <JobStatusBadge status={job.status} />
              </td>
              <td>{new Date(job.created_at).toLocaleDateString("pt-BR")}</td>
              <td>
                {job.final_video_path ? (
                  <a className="button secondary" href={job.final_video_path}>
                    <Download size={16} /> Baixar
                  </a>
                ) : (
                  <span className="muted">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
