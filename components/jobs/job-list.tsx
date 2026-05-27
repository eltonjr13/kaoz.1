import { Download, ExternalLink } from "lucide-react";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import type { JobListItem } from "@/app/(dashboard)/jobs/page";

function getRelatedOne<T>(value: T[] | T | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function getPlatformLabel(platform: string) {
  if (platform === "youtube") {
    return "YouTube";
  }

  if (platform === "instagram") {
    return "Instagram";
  }

  if (platform === "tiktok") {
    return "TikTok";
  }

  return "Video";
}

export function JobList({ jobs }: { jobs: JobListItem[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Assunto</th>
            <th>Avatar</th>
            <th>Fonte</th>
            <th>Status</th>
            <th>Criado em</th>
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const avatar = getRelatedOne(job.avatars);
            const sourceVideo = getRelatedOne(job.viral_videos);

            return (
              <tr key={job.id}>
                <td>{job.topic}</td>
                <td>{avatar?.name ?? "Avatar removido"}</td>
                <td>
                  {sourceVideo ? (
                    <a className="source-link" href={sourceVideo.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} />
                      {getPlatformLabel(sourceVideo.platform)}
                    </a>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
