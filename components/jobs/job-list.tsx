"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";
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
  const [colabJob, setColabJob] = useState<JobListItem | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleUploadLipsync() {
    if (!colabJob || !uploadFile) return;

    setUploading(true);
    setUploadError("");

    const formData = new FormData();
    formData.append("jobId", colabJob.id);
    formData.append("file", uploadFile);

    try {
      const response = await fetch("/api/jobs/upload-lipsync", {
        method: "POST",
        body: formData
      });

      if (response.ok) {
        setColabJob(null);
        setUploadFile(null);
        router.refresh();
      } else {
        const errorData = await response.json().catch(() => ({}));
        setUploadError(errorData.error || "Erro ao fazer upload do vídeo.");
      }
    } catch (err) {
      console.error("Erro de conexão ao enviar vídeo:", err);
      setUploadError("Erro de conexão com o servidor.");
    } finally {
      setUploading(false);
    }
  }

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
    <>
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
                  ) : job.status === "lip_syncing" ? (
                    <button
                      className="button"
                      style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: "6px",
                        padding: "6px 12px",
                        fontSize: "13px",
                        minHeight: "auto",
                        background: "var(--brand)",
                        color: "#fff"
                      }}
                      onClick={() => setColabJob(job)}
                    >
                      Sincronizar (Colab)
                    </button>
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
    
    {colabJob && (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px"
      }}>
        <div style={{
          backgroundColor: "var(--panel)",
          borderRadius: "12px",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)",
          width: "100%",
          maxWidth: "560px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          maxHeight: "90vh",
          overflowY: "auto"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800 }}>Sincronização Labial (Google Colab)</h2>
            <button 
              onClick={() => { setColabJob(null); setUploadFile(null); setUploadError(""); }}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", padding: 4 }}
            >
              <X size={20} />
            </button>
          </div>

          <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)", lineHeight: 1.5 }}>
            Siga as etapas abaixo para gerar a sincronização labial do seu avatar gratuitamente usando o processamento em GPU do Google Colab:
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Passo 1 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "0.86rem", fontWeight: 800 }}>Passo 1: Baixe os arquivos necessários</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <a 
                  className="button secondary" 
                  style={{ fontSize: "0.8rem", minHeight: "36px", padding: "0 12px", flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  href={`/api/jobs/download-asset?path=${encodeURIComponent(colabJob.audio_path || "")}`}
                  download
                >
                  <Download size={14} /> Áudio de Voz
                </a>
                {(() => {
                  const avatar = getRelatedOne(colabJob.avatars);
                  const avatarPath = avatar?.image_path || "";
                  return (
                    <a 
                      className="button secondary" 
                      style={{ fontSize: "0.8rem", minHeight: "36px", padding: "0 12px", flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                      href={`/api/jobs/download-asset?path=${encodeURIComponent(avatarPath)}&bucket=avatars`}
                      download
                    >
                      <Download size={14} /> Vídeo/Imagem Base
                    </a>
                  );
                })()}
              </div>
            </div>

            {/* Passo 2 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "0.86rem", fontWeight: 800 }}>Passo 2: Baixe e abra o Notebook no Google Colab</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <a 
                  className="button secondary" 
                  style={{ fontSize: "0.8rem", minHeight: "36px", padding: "0 12px", flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  href="/mrchicken_lipsync_colab.ipynb"
                  download
                >
                  <Download size={14} /> Baixar Notebook (.ipynb)
                </a>
                <a 
                  className="button" 
                  style={{ fontSize: "0.8rem", minHeight: "36px", padding: "0 12px", flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  href="https://colab.research.google.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} /> Abrir Google Colab
                </a>
              </div>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                Dica: No Google Colab, vá em "Fazer Upload" e envie o arquivo <code>mrchicken_lipsync_colab.ipynb</code> que você acabou de baixar.
              </span>
            </div>

            {/* Passo 3 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "0.86rem", fontWeight: 800 }}>Passo 3: Envie o vídeo resultante (result.mp4)</span>
              <input 
                type="file" 
                accept="video/mp4"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setUploadFile(file);
                  setUploadError("");
                }}
                style={{ 
                  border: "1px dashed var(--line)", 
                  padding: "12px", 
                  borderRadius: "8px", 
                  background: "var(--panel-strong)",
                  fontSize: "0.85rem"
                }}
              />
            </div>
          </div>

          {uploadError && (
            <span style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{uploadError}</span>
          )}

          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "10px" }}>
            <button 
              className="button secondary" 
              onClick={() => { setColabJob(null); setUploadFile(null); setUploadError(""); }}
              disabled={uploading}
            >
              Cancelar
            </button>
            <button 
              className="button" 
              onClick={handleUploadLipsync}
              disabled={!uploadFile || uploading}
            >
              {uploading ? "Enviando..." : "Enviar e Renderizar"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

