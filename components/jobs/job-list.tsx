"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, RefreshCw, X, ThumbsUp, ThumbsDown } from "lucide-react";
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

function formatRelativeTime(iso?: string | null) {
  if (!iso) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.max(1, Math.floor(diffMs / 1000));
  if (diffSeconds < 60) {
    return `há ${diffSeconds}s`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `há ${diffMinutes}m`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `há ${diffHours}h`;
  }

  return `há ${Math.floor(diffHours / 24)}d`;
}

function getStatusHint(status: JobListItem["status"]) {
  switch (status) {
    case "queued":
      return "Na fila aguardando processamento.";
    case "researching":
      return "Baixando e preparando a fonte.";
    case "scripting":
      return "Gerando roteiro.";
    case "voice_generating":
      return "Gerando a voz.";
    case "lip_syncing":
      return "Sincronizando boca em tempo real.";
    case "rendering":
      return "Montando o vídeo final.";
    case "review":
      return "Pronto para revisão.";
    case "completed":
      return "Finalizado com sucesso.";
    case "failed":
      return "Falhou e precisa de atenção.";
    default:
      return "Job em andamento.";
  }
}

function JobSourceCell({ sourceUrl, sourceLabel }: { sourceUrl: string | null; sourceLabel: string }) {
  if (!sourceUrl) {
    return <span className="muted">-</span>;
  }
  return (
    <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">
      <ExternalLink size={15} />
      {sourceLabel}
    </a>
  );
}

function JobStatusCell({ job }: { job: JobListItem }) {
  const badgeMessage = job.latest_event_message || getStatusHint(job.status);
  const pulseMessage = job.latest_event_at
    ? `Último pulso ${formatRelativeTime(job.latest_event_at)}`
    : `Atualizado ${formatRelativeTime(job.updated_at)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <JobStatusBadge status={job.status} />
      <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.35 }}>
        {badgeMessage}
      </span>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>
        {pulseMessage}
      </span>
    </div>
  );
}

function JobActionsCell({
  job,
  loadingJobId,
  onRestart,
  onColabSync,
  onEvaluate
}: {
  job: JobListItem;
  loadingJobId: string | null;
  onRestart: (jobId: string, startFrom?: "lipsync") => void;
  onColabSync: (job: JobListItem) => void;
  onEvaluate: (jobId: string, feedback: 'good' | 'bad') => void;
}) {
  const isLipSyncing = job.status === "lip_syncing";
  const showRestart = !job.final_video_path && !isLipSyncing;
  const showRefakeLipSync = !!(
    job.audio_path &&
    job.status !== "researching" &&
    job.status !== "scripting" &&
    job.status !== "voice_generating" &&
    job.status !== "queued"
  );

  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      {job.final_video_path && (
        <a className="button secondary" href={job.final_video_path}>
          <Download size={16} /> Baixar
        </a>
      )}

      {isLipSyncing && (
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
          onClick={() => onColabSync(job)}
        >
          Sincronizar (Colab)
        </button>
      )}

      {showRestart && (
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
          onClick={() => onRestart(job.id)}
          disabled={loadingJobId !== null}
        >
          <RefreshCw size={14} className={loadingJobId === job.id ? "spin-icon" : ""} />
          {loadingJobId === job.id ? "Iniciando..." : "Reiniciar"}
        </button>
      )}

      {showRefakeLipSync && (
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
          onClick={() => onRestart(job.id, "lipsync")}
          disabled={loadingJobId !== null}
        >
          <RefreshCw size={14} className={loadingJobId === `${job.id}-lipsync` ? "spin-icon" : ""} />
          {loadingJobId === `${job.id}-lipsync` ? "Iniciando..." : "Refazer LipSync"}
        </button>
      )}

      {job.status === "completed" && (
        <div style={{ display: "flex", gap: "4px", borderLeft: "1px solid var(--line)", paddingLeft: "8px", marginLeft: "4px" }}>
          <button
            type="button"
            title="Amei o resultado (👍)"
            style={{
              border: "none",
              background: job.feedback === "good" ? "rgba(16, 185, 129, 0.15)" : "transparent",
              color: job.feedback === "good" ? "#10b981" : "var(--muted)",
              cursor: "pointer",
              borderRadius: "6px",
              padding: "6px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.15s ease, background 0.2s",
            }}
            onClick={() => onEvaluate(job.id, "good")}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.15)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            <ThumbsUp size={15} fill={job.feedback === "good" ? "#10b981" : "none"} />
          </button>
          <button
            type="button"
            title="Não gostei do resultado (👎)"
            style={{
              border: "none",
              background: job.feedback === "bad" ? "rgba(239, 68, 68, 0.15)" : "transparent",
              color: job.feedback === "bad" ? "#ef4444" : "var(--muted)",
              cursor: "pointer",
              borderRadius: "6px",
              padding: "6px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.15s ease, background 0.2s",
            }}
            onClick={() => onEvaluate(job.id, "bad")}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.15)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            <ThumbsDown size={15} fill={job.feedback === "bad" ? "#ef4444" : "none"} />
          </button>
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  loadingJobId,
  onRestart,
  onColabSync,
  onEvaluate
}: {
  job: JobListItem;
  loadingJobId: string | null;
  onRestart: (jobId: string, startFrom?: "lipsync") => void;
  onColabSync: (job: JobListItem) => void;
  onEvaluate: (jobId: string, feedback: 'good' | 'bad') => void;
}) {
  const avatar = getRelatedOne(job.avatars);
  const sourceVideo = getRelatedOne(job.viral_videos);
  const sourceUrl = sourceVideo?.url ?? job.source_video_url ?? null;
  const sourceLabel = sourceVideo?.platform ? getPlatformLabel(sourceVideo.platform) : "Video local";

  return (
    <tr>
      <td>{job.topic}</td>
      <td>{avatar?.name ?? "Avatar removido"}</td>
      <td>
        <JobSourceCell sourceUrl={sourceUrl} sourceLabel={sourceLabel} />
      </td>
      <td>
        <JobStatusCell job={job} />
      </td>
      <td>{new Date(job.created_at).toLocaleDateString("pt-BR")}</td>
      <td>
        <JobActionsCell
          job={job}
          loadingJobId={loadingJobId}
          onRestart={onRestart}
          onColabSync={onColabSync}
          onEvaluate={onEvaluate}
        />
      </td>
    </tr>
  );
}

export function JobList({ jobs }: { jobs: JobListItem[] }) {
  const router = useRouter();
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [colabJob, setColabJob] = useState<JobListItem | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [colabMode, setColabMode] = useState<"auto" | "manual">("auto");
  const [evaluations, setEvaluations] = useState<Record<string, 'good' | 'bad'>>({});
  const hasActiveJobs = useMemo(
    () => jobs.some((job) => ["queued", "researching", "scripting", "voice_generating", "lip_syncing", "rendering"].includes(job.status)),
    [jobs]
  );

  const renderedJobs = useMemo(() => {
    return jobs.map((job) => ({
      ...job,
      feedback: evaluations[job.id] !== undefined ? evaluations[job.id] : job.feedback
    }));
  }, [jobs, evaluations]);

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 8000);

    return () => window.clearInterval(interval);
  }, [hasActiveJobs, router]);

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

  async function handleRestart(jobId: string, startFrom?: "lipsync") {
    const loadingKey = startFrom ? `${jobId}-${startFrom}` : jobId;
    setLoadingJobId(loadingKey);
    try {
      const response = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, startFrom })
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

  async function handleEvaluate(jobId: string, feedback: 'good' | 'bad') {
    setEvaluations((prev) => ({ ...prev, [jobId]: feedback }));
    try {
      const response = await fetch("/api/jobs/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, feedback })
      });
      if (!response.ok) {
        console.error("Falha ao enviar avaliação para o servidor.");
      }
      router.refresh();
    } catch (err) {
      console.error("Erro ao enviar avaliação:", err);
    }
  }

  return (
    <>
      <div className="table-wrap">
        {hasActiveJobs && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            fontSize: 12,
            color: "var(--muted)"
          }}>
            <RefreshCw size={14} className="spin-icon" />
            Atualização automática ativa enquanto houver jobs em processamento.
          </div>
        )}
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
          {renderedJobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              loadingJobId={loadingJobId}
              onRestart={handleRestart}
              onColabSync={setColabJob}
              onEvaluate={handleEvaluate}
            />
          ))}
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
            Selecione como deseja realizar a sincronização labial usando o Google Colab:
          </p>

          <div style={{ display: "flex", borderBottom: "1px solid var(--line)", gap: "4px", margin: "4px 0" }}>
            <button
              onClick={() => setColabMode("auto")}
              style={{
                background: "none",
                border: "none",
                borderBottom: colabMode === "auto" ? "2px solid var(--brand)" : "2px solid transparent",
                color: colabMode === "auto" ? "var(--text)" : "var(--muted)",
                padding: "8px 12px",
                fontWeight: 800,
                cursor: "pointer",
                fontSize: "0.9rem"
              }}
            >
              Fila Automática (Em Massa)
            </button>
            <button
              onClick={() => setColabMode("manual")}
              style={{
                background: "none",
                border: "none",
                borderBottom: colabMode === "manual" ? "2px solid var(--brand)" : "2px solid transparent",
                color: colabMode === "manual" ? "var(--text)" : "var(--muted)",
                padding: "8px 12px",
                fontWeight: 800,
                cursor: "pointer",
                fontSize: "0.9rem"
              }}
            >
              Processamento Manual (Individual)
            </button>
          </div>

          {colabMode === "auto" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.86rem", fontWeight: 800 }}>Passo 1: Baixe e abra o Notebook no Google Colab</span>
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
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "0.86rem", fontWeight: 800 }}>Passo 2: Configure as credenciais no Colab</span>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.4 }}>
                  No Google Colab, vá para o <strong>Passo 6: Modo Fila Automática</strong> e insira as seguintes chaves de acesso:
                </span>
                
                <div style={{ display: "grid", gap: "8px", background: "var(--panel-strong)", padding: "12px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <div>
                    <label style={{ fontSize: "0.74rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: "2px" }}>ARMAZENAMENTO</label>
                    <input 
                      readOnly 
                      value="local" 
                      style={{ fontSize: "0.8rem", padding: "6px", width: "100%", borderRadius: "4px", border: "1px solid var(--line)", background: "var(--panel)", color: "var(--text)" }}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.74rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: "2px" }}>PASTA DE DADOS</label>
                    <input 
                      readOnly 
                      value=".generated/local-data" 
                      style={{ fontSize: "0.8rem", padding: "6px", width: "100%", borderRadius: "4px", border: "1px solid var(--line)", background: "var(--panel)", color: "var(--text)" }}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.86rem", fontWeight: 800 }}>Passo 3: Execute o loop do Colab</span>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.4 }}>
                  Execute a célula do Passo 6. Ela ficará ativamente aguardando novos vídeos de reação na fila do painel, gerando o lip-sync e devolvendo a renderização automaticamente a cada 20s.
                </span>
              </div>
            </div>
          ) : (
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
                  Dica: No Google Colab, vá em &quot;Fazer Upload&quot; e envie o arquivo <code>mrchicken_lipsync_colab.ipynb</code> que você acabou de baixar.
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
          )}

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

