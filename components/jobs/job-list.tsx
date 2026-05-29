"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
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
  const router = useRouter();
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);

  async function handleRestart(jobId: string) {
    setLoadingJobId(jobId);
    try {
      const response = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId })
      });
      if (response.ok) {
        router.refresh();
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || "Erro ao reiniciar o pipeline.");
      }
    } catch (err) {
      console.error("Erro de conexão ao reiniciar o pipeline:", err);
      alert("Erro de conexão ao reiniciar o pipeline.");
    } finally {
      setLoadingJobId(null);
    }
  }

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
            <th>Ações / Download</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const avatar = getRelatedOne(job.avatars);
            const sourceVideo = getRelatedOne(job.viral_videos);
            const sourceUrl = sourceVideo?.url ?? job.source_video_url ?? null;
            const sourceLabel = sourceVideo?.platform ? getPlatformLabel(sourceVideo.platform) : "Video local";

            return (
              <tr key={job.id}>
                <td>{job.topic}</td>
                <td>{avatar?.name ?? "Avatar removido"}</td>
                <td>
                  {sourceUrl ? (
                    <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} />
                      {sourceLabel}
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
                    <button
                      className="button secondary"
                      style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: "6px",
                        padding: "6px 12px",
                        fontSize: "13px",
                        minHeight: "auto"
                      }}
                      onClick={() => handleRestart(job.id)}
                      disabled={loadingJobId !== null}
                    >
                      <RefreshCw size={14} className={loadingJobId === job.id ? "spin-icon" : ""} />
                      {loadingJobId === job.id ? "Iniciando..." : "Reiniciar"}
                    </button>
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
