"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, CheckCircle, Download, ExternalLink, Play, RefreshCw, Rocket, RotateCcw, ChevronDown, ChevronUp, Scissors, Settings, Upload } from "lucide-react";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import type { Avatar, ExpertBackgroundMode, JobStatus, RenderLayout, VoiceDirection } from "@/types";
import { getSourceVideoPlatformLabel, parseSourceVideoUrl } from "@/lib/videos/source-video";

function getMediaUrl(filePath: string | null | undefined) {
  if (!filePath) return "";
  return filePath.startsWith("/") ? filePath : `/${filePath}`;
}

const isVideo = (path: string) => /\.(mp4|mov|webm|mkv|avi)$/i.test(path);

type CreateJobFormProps = {
  avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status" | "voice_reference_path" | "parent_id">[];
  initialTopic?: string;
  initialSourceVideoUrl?: string;
  initialSourceVideoTitle?: string;
};

type AvatarOption = CreateJobFormProps["avatars"][number];

type TrackedJob = {
  id: string;
  topic: string;
  status: JobStatus;
  final_video_path: string | null;
  audio_path?: string | null;
  error_message: string | null;
  updated_at: string;
};

type TrackedJobEvent = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
};

const layoutOptions: { value: RenderLayout; label: string; description: string }[] = [
  {
    value: "source_pip",
    label: "Fonte cheia + expert",
    description: "Video principal em tela cheia com expert menor no canto."
  },
  {
    value: "source_top_expert_bottom",
    label: "Fonte dominante",
    description: "Video fonte no topo com expert menor embaixo."
  },
  {
    value: "balanced_split",
    label: "Divisao equilibrada",
    description: "Video fonte maior, mas com expert ainda bem visivel."
  }
];

const formSteps = [
  { value: 1, label: "Origem" },
  { value: 2, label: "Plano" },
  { value: 3, label: "Revisao" }
];

const activeJobStatuses = new Set<JobStatus>([
  "queued",
  "researching",
  "scripting",
  "voice_generating",
  "lip_syncing",
  "rendering"
]);

function isActiveJobStatus(status: JobStatus) {
  return activeJobStatuses.has(status);
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffSeconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return `ha ${diffSeconds}s`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `ha ${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `ha ${diffHours}h`;

  return `ha ${Math.floor(diffHours / 24)}d`;
}

async function readTrackedJobResponse(response: Response) {
  if (!response.ok) return undefined;

  const payload = (await response.json().catch(() => ({}))) as { jobs?: TrackedJob[] };
  return payload.jobs?.[0] ?? null;
}

async function readTrackedEventsResponse(response: Response) {
  if (!response.ok) return undefined;

  const payload = (await response.json().catch(() => ({}))) as { events?: TrackedJobEvent[] };
  return payload.events ?? [];
}

async function fetchTrackedJobSnapshot(jobId: string) {
  const [jobResponse, eventsResponse] = await Promise.all([
    fetch(`/api/jobs?jobId=${encodeURIComponent(jobId)}`),
    fetch(`/api/jobs/events?jobId=${encodeURIComponent(jobId)}`)
  ]);

  const [job, events] = await Promise.all([
    readTrackedJobResponse(jobResponse),
    readTrackedEventsResponse(eventsResponse)
  ]);

  return { job, events };
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      {formSteps.map((item, index) => (
        <div key={item.value} style={{ display: "contents" }}>
          <span
            className={`status-badge ${
              currentStep === item.value ? "queued" : currentStep > item.value ? "completed" : ""
            }`}
            style={{ padding: "4px 10px" }}
          >
            Etapa {item.value}: {item.label}
          </span>
          {index < formSteps.length - 1 ? (
            <div style={{ flex: 1, height: "2px", background: "var(--line)" }} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CompactSettingsPanel({
  title,
  summary,
  icon,
  open,
  onToggle,
  children
}: {
  title: string;
  summary: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="advanced-settings-panel">
      <button
        type="button"
        className="advanced-settings-header button secondary full"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          border: "none",
          borderRadius: 0,
          background: "none",
          minHeight: "48px",
          padding: "12px 16px"
        }}
        onClick={onToggle}
      >
        <span style={{ display: "flex", minWidth: 0, alignItems: "center", gap: "8px", fontWeight: 800 }}>
          {icon}
          <span>{title}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)", fontSize: "0.78rem", fontWeight: 500 }}>
            {summary}
          </span>
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open ? <div className="advanced-settings-content">{children}</div> : null}
    </div>
  );
}

function SummaryPanel({
  label,
  children,
  meta,
  actionLabel,
  disabled,
  onAction
}: {
  label: string;
  children: ReactNode;
  meta?: ReactNode;
  actionLabel: string;
  disabled?: boolean;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        background: "var(--panel-strong)",
        borderRadius: "8px",
        marginBottom: "20px",
        border: "1px solid var(--line)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "16px"
      }}
    >
      <div>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: "bold", display: "block" }}>
          {label}
        </span>
        <span style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>{children}</span>
        {meta ? (
          <span style={{ fontSize: "0.84rem", display: "block", marginTop: "4px", color: "var(--brand)", fontWeight: 700 }}>
            {meta}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="button secondary"
        style={{ minHeight: "36px", padding: "0 12px", fontSize: "0.82rem", flexShrink: 0 }}
        onClick={onAction}
        disabled={disabled}
      >
        {actionLabel}
      </button>
    </div>
  );
}

type GenerationTrackerProps = {
  job: TrackedJob;
  events: TrackedJobEvent[];
  isRefreshing: boolean;
  isRestarting: boolean;
  onRefresh: () => void;
  onRestart: (startFrom?: "lipsync") => void;
};

function TrackerHeader({
  job,
  latestEvent,
  isRefreshing,
  onRefresh
}: Pick<GenerationTrackerProps, "job" | "isRefreshing" | "onRefresh"> & {
  latestEvent?: TrackedJobEvent;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Acompanhamento da geracao
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <JobStatusBadge status={job.status} />
          {isActiveJobStatus(job.status) ? (
            <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>Atualizacao automatica ativa</span>
          ) : null}
        </div>
        <strong style={{ fontSize: "0.95rem" }}>{job.topic}</strong>
        <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
          {latestEvent?.message || job.error_message || `Atualizado ${formatRelativeTime(job.updated_at)}`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {job.final_video_path ? (
          <a className="button" href={job.final_video_path}>
            <Download size={16} /> Baixar
          </a>
        ) : null}
        <Link className="button secondary" href={`/jobs#job-${job.id}`}>
          <ExternalLink size={16} /> Ver detalhes
        </Link>
        <button className="button secondary" type="button" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw size={16} className={isRefreshing ? "spin-icon" : ""} />
          Atualizar
        </button>
      </div>
    </div>
  );
}

function TrackerNotice({ job }: { job: TrackedJob }) {
  if (job.status === "failed" && job.error_message) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--danger)", fontSize: "0.85rem" }}>
        <AlertCircle size={16} /> {job.error_message}
      </div>
    );
  }

  if (job.status === "completed") {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--success)", fontSize: "0.85rem" }}>
        <CheckCircle size={16} /> Geracao concluida.
      </div>
    );
  }

  return null;
}

function TrackerEvents({ events }: { events: TrackedJobEvent[] }) {
  if (events.length === 0) {
    return (
      <span style={{ color: "var(--muted)", fontSize: "0.84rem" }}>
        Os eventos do job aparecem aqui assim que o pipeline registrar o primeiro passo.
      </span>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase" }}>
        Ultimos eventos
      </span>
      <div style={{ display: "grid", gap: 6 }}>
        {events.slice(-5).reverse().map((event) => (
          <div
            key={event.id}
            style={{
              display: "grid",
              gap: 2,
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "8px 10px",
              background: "var(--panel-strong)"
            }}
          >
            <span style={{ fontSize: "0.84rem" }}>{event.message}</span>
            <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
              {event.event_type} - {formatRelativeTime(event.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrackerRestartActions({
  job,
  isRestarting,
  onRestart
}: Pick<GenerationTrackerProps, "job" | "isRestarting" | "onRestart">) {
  const canRestart = !isActiveJobStatus(job.status);
  const canRestartFromLipSync = Boolean(job.audio_path) && job.status !== "queued" && job.status !== "researching" && job.status !== "scripting" && job.status !== "voice_generating";

  if (!canRestart) return null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="button secondary" type="button" onClick={() => onRestart()} disabled={isRestarting}>
        <RefreshCw size={16} className={isRestarting ? "spin-icon" : ""} />
        {isRestarting ? "Reiniciando..." : "Reiniciar pipeline"}
      </button>
      {canRestartFromLipSync ? (
        <button className="button secondary" type="button" onClick={() => onRestart("lipsync")} disabled={isRestarting}>
          Refazer lip-sync
        </button>
      ) : null}
    </div>
  );
}

function GenerationTracker({
  job,
  events,
  isRefreshing,
  isRestarting,
  onRefresh,
  onRestart
}: GenerationTrackerProps) {
  const latestEvent = events[events.length - 1];

  return (
    <section
      style={{
        border: "1px solid var(--line)",
        background: "var(--panel)",
        borderRadius: 8,
        padding: 16,
        display: "grid",
        gap: 14
      }}
      aria-live="polite"
    >
      <TrackerHeader
        job={job}
        latestEvent={latestEvent}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
      />
      <TrackerNotice job={job} />
      <TrackerEvents events={events} />
      <TrackerRestartActions
        job={job}
        isRestarting={isRestarting}
        onRestart={onRestart}
      />
    </section>
  );
}

function AvatarVersionPreview({ avatar }: { avatar: AvatarOption | null }) {
  if (!avatar) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: 10, background: "var(--bg-soft)", borderRadius: 8, border: "1px solid var(--line)" }}>
      <div style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "#000", flexShrink: 0 }}>
        {avatar.image_path ? (
          isVideo(avatar.image_path) ? (
            <video
              src={getMediaUrl(avatar.image_path)}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <img
              src={getMediaUrl(avatar.image_path)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              alt="Avatar preview"
            />
          )
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
          {avatar.name || "Avatar padrao"}
        </span>
        <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          {avatar.parent_id ? "Versao do avatar" : "Versao principal padrao"}
        </span>
      </div>
    </div>
  );
}

export function CreateJobForm({
  avatars,
  initialTopic = "",
  initialSourceVideoUrl = "",
  initialSourceVideoTitle = ""
}: CreateJobFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [topic, setTopic] = useState(initialTopic);
  
  // Parent and Version Selection states
  const mainAvatars = avatars.filter((a) => !a.parent_id);
  const [parentId, setParentId] = useState(mainAvatars[0]?.id ?? "");
  const [versionId, setVersionId] = useState(mainAvatars[0]?.id ?? "");

  // Video base swapping states
  const [swappedVideoFile, setSwappedVideoFile] = useState<File | null>(null);
  const [saveAsNewVersion, setSaveAsNewVersion] = useState(true);
  const [newVersionName, setNewVersionName] = useState("");

  const avatarId = versionId;

  function handleParentChange(newParentId: string) {
    setParentId(newParentId);
    setVersionId(newParentId);
    setSwappedVideoFile(null);
    setNewVersionName("");
  }

  const [sourceVideoUrl, setSourceVideoUrl] = useState(initialSourceVideoUrl);
  const [sourceVideoTitle, setSourceVideoTitle] = useState(initialSourceVideoTitle);
  const [renderLayout, setRenderLayout] = useState<RenderLayout>("source_pip");
  const [expertBackgroundMode, setExpertBackgroundMode] = useState<ExpertBackgroundMode>("original");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [trackedJob, setTrackedJob] = useState<TrackedJob | null>(null);
  const [trackedEvents, setTrackedEvents] = useState<TrackedJobEvent[]>([]);
  const [isRefreshingJob, setIsRefreshingJob] = useState(false);
  const [isRestartingJob, setIsRestartingJob] = useState(false);

  // Video analysis and editing states
  const [scriptText, setScriptText] = useState("");
  const [voiceDirection, setVoiceDirection] = useState<VoiceDirection | null>(null);
  const [sourceVideoDescription, setSourceVideoDescription] = useState("");
  const [sourceVideoTranscription, setSourceVideoTranscription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);

  // Video trimming state
  const [shouldTrim, setShouldTrim] = useState(true);
  const [trimStart, setTrimStart] = useState("00:00");
  const [trimEnd, setTrimEnd] = useState("00:15");

  const parsedSourceVideo = sourceVideoUrl.trim() ? parseSourceVideoUrl(sourceVideoUrl) : null;
  const SourceIcon = parsedSourceVideo?.platform === "instagram" ? Camera : Play;
  const canRemoveExpertBackground = renderLayout === "source_pip";
  const selectedAvatar = avatars.find((avatar) => avatar.id === versionId) ?? null;

  // Voice advanced settings state
  const [inferenceSteps, setInferenceSteps] = useState(32);
  const [guidanceScale, setGuidanceScale] = useState(3);
  const [denoiseRatio, setDenoiseRatio] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const [preprocessPrompt, setPreprocessPrompt] = useState(true);
  const [postprocessOutput, setPostprocessOutput] = useState(true);
  const [showAdvancedVoice, setShowAdvancedVoice] = useState(false);
  const [showLayoutSettings, setShowLayoutSettings] = useState(false);

  const refreshTrackedJob = useCallback(async (jobId: string, options?: { silent?: boolean }) => {
    const showLoading = options?.silent !== true;
    if (showLoading) setIsRefreshingJob(true);

    try {
      const { job, events } = await fetchTrackedJobSnapshot(jobId);
      if (job !== undefined) setTrackedJob(job);
      if (events !== undefined) setTrackedEvents(events);
    } catch {
      if (showLoading) {
        setMessage("Nao foi possivel atualizar o acompanhamento do job.");
      }
    } finally {
      if (showLoading) setIsRefreshingJob(false);
    }
  }, []);

  useEffect(() => {
    if (!trackedJob || !isActiveJobStatus(trackedJob.status)) return;

    const interval = window.setInterval(() => {
      void refreshTrackedJob(trackedJob.id, { silent: true });
    }, 4000);

    return () => window.clearInterval(interval);
  }, [refreshTrackedJob, trackedJob]);

  async function handleRestartJob(startFrom?: "lipsync") {
    if (!trackedJob) return;

    setMessage("");
    setIsRestartingJob(true);
    try {
      const response = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: trackedJob.id, startFrom })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage(payload.error ?? "Nao foi possivel reiniciar o pipeline.");
        return;
      }

      setMessage(startFrom === "lipsync" ? "Lip-sync reiniciado." : "Pipeline reiniciado.");
      await refreshTrackedJob(trackedJob.id);
      router.refresh();
    } catch {
      setMessage("Erro de conexao ao reiniciar o pipeline.");
    } finally {
      setIsRestartingJob(false);
    }
  }

  async function handleStep1Analyze() {
    setMessage("");
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/pipeline/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceVideoUrl: sourceVideoUrl.trim(),
          trimStart: shouldTrim ? trimStart.trim() || null : null,
          trimEnd: shouldTrim ? trimEnd.trim() || null : null
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || "Falha ao analisar o video.");
        return;
      }

      setSourceVideoDescription(data.description || "");
      setSourceVideoTranscription(data.transcription || "");
      if (data.topic) setTopic(data.topic);
      if (data.title) setSourceVideoTitle(data.title);
      setStep(2); // Avanca para a Etapa 2 de parametros
    } catch (err) {
      console.error(err);
      setMessage("Erro de conexao ao solicitar analise do video.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleGenerateScript() {
    setMessage("");
    setIsGeneratingScript(true);
    try {
      const response = await fetch("/api/pipeline/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          description: sourceVideoDescription,
          transcription: sourceVideoTranscription,
          avatarId
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || "Falha ao gerar roteiro.");
        return;
      }

      setScriptText(data.script || "");
      setVoiceDirection(data.voiceDirection || null);
      setStep(3); // Avanca para a Etapa 3 de revisao do roteiro
    } catch (err) {
      console.error(err);
      setMessage("Erro de conexao ao solicitar geracao do roteiro.");
    } finally {
      setIsGeneratingScript(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (sourceVideoUrl.trim() && !parsedSourceVideo) {
      setMessage("Use um link direto valido de video, reel, short ou mp4.");
      return;
    }

    setIsLoading(true);
    let finalAvatarId = avatarId;

    if (swappedVideoFile) {
      setMessage("Processando arquivo de video do avatar...");
      try {
        if (saveAsNewVersion) {
          const formData = new FormData();
          formData.append("name", newVersionName.trim() || `Versao via Job - ${new Date().toLocaleDateString("pt-BR")}`);
          formData.append("image", swappedVideoFile);
          formData.append("parent_id", parentId);
          formData.append("consentAccepted", "true");

          const response = await fetch("/api/avatars", {
            method: "POST",
            body: formData
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Nao foi possivel salvar o novo video como versao.");
          }

          const data = await response.json();
          finalAvatarId = data.avatar.id;
        } else {
          const formData = new FormData();
          formData.append("image", swappedVideoFile);

          const response = await fetch(`/api/avatars/${versionId}`, {
            method: "PATCH",
            body: formData
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Nao foi possivel atualizar o video base da versao.");
          }
        }
      } catch (err) {
        setIsLoading(false);
        setMessage(err instanceof Error ? err.message : "Erro ao processar video do avatar.");
        return;
      }
    }

    try {
      const createResponse = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          avatarId: finalAvatarId,
          sourceVideoUrl: sourceVideoUrl.trim() || null,
          sourceVideoTitle: sourceVideoTitle.trim() || null,
          renderLayout,
          expertBackgroundMode,
          trimStart: shouldTrim ? trimStart.trim() || null : null,
          trimEnd: shouldTrim ? trimEnd.trim() || null : null,
          scriptText,
          voiceDirection,
          sourceVideoDescription,
          sourceVideoTranscription,
          voiceSettings: {
            inference_steps: inferenceSteps,
            guidance_scale: guidanceScale,
            denoise_ratio: denoiseRatio,
            speed,
            duration,
            preprocess_prompt: preprocessPrompt,
            postprocess_output: postprocessOutput
          }
        })
      });

      const createPayload = (await createResponse.json()) as { job?: TrackedJob; error?: string };

      if (!createResponse.ok || !createPayload.job) {
        setIsLoading(false);
        setMessage(createPayload.error ?? "Nao foi possivel criar o job.");
        return;
      }

      setTrackedJob(createPayload.job);
      setTrackedEvents([]);

      const startResponse = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: createPayload.job.id })
      });

      setIsLoading(false);

      if (!startResponse.ok) {
        const payload = (await startResponse.json()) as { error?: string };
        setMessage(payload.error ?? "Job criado, mas o pipeline nao iniciou.");
        await refreshTrackedJob(createPayload.job.id);
        return;
      }

      setMessage("Job criado e pipeline iniciado.");
      await refreshTrackedJob(createPayload.job.id);
      router.refresh();
    } catch {
      setIsLoading(false);
      setMessage("Erro de conexao ao processar requisicoes.");
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <StepIndicator currentStep={step} />

      {step === 1 && (
        /* STEP 1: Video selection and trimming */
        <div>
          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="sourceVideoUrl">Link do video para colagem</label>
            <input
              id="sourceVideoUrl"
              value={sourceVideoUrl}
              onChange={(event) => setSourceVideoUrl(event.target.value)}
              placeholder="Link direto do reel, short ou video mp4"
              required
            />
            <span className="field-hint">Suporta links do YouTube, Instagram Reels e TikTok.</span>
          </div>

          <div className="field" style={{ marginTop: "20px" }}>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={shouldTrim}
                onChange={(event) => setShouldTrim(event.target.checked)}
              />
              <Scissors size={18} />
              <span>Cortar/Limitar trecho do video?</span>
            </label>
            <span className="field-hint">
              Recorta o video original antes de fazer a analise de IA e renderizacao final.
            </span>
          </div>

          {shouldTrim && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label htmlFor="trimStart">Inicio do trecho (segundos ou MM:SS)</label>
                <input
                  id="trimStart"
                  value={trimStart}
                  onChange={(e) => setTrimStart(e.target.value)}
                  placeholder="00:00"
                />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label htmlFor="trimEnd">Fim do trecho (segundos ou MM:SS)</label>
                <input
                  id="trimEnd"
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(e.target.value)}
                  placeholder="00:15"
                />
              </div>
            </div>
          )}

          {shouldTrim && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("00:00");
                  setTrimEnd("00:10");
                }}
              >
                10s Iniciais
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("00:00");
                  setTrimEnd("00:15");
                }}
              >
                15s Iniciais
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("00:00");
                  setTrimEnd("00:30");
                }}
              >
                30s Iniciais
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("");
                  setTrimEnd("");
                }}
              >
                Video Completo
              </button>
            </div>
          )}

          <div className="row-actions" style={{ marginTop: "32px" }}>
            <button
              type="button"
              className="button"
              disabled={isAnalyzing || !sourceVideoUrl.trim()}
              onClick={handleStep1Analyze}
            >
              {isAnalyzing ? "Analisando com Gemini..." : "Analisar video e avancar"}
            </button>
          </div>
          {message ? <p className="form-message" style={{ marginTop: "12px" }}>{message}</p> : null}
        </div>
      )}

      {step === 2 && (
        /* STEP 2: React Settings */
        <div>
          <SummaryPanel
            label="Video de origem selecionado"
            actionLabel="Alterar"
            onAction={() => setStep(1)}
            meta={shouldTrim ? `Trecho: de ${trimStart || "0"} ate ${trimEnd || "fim"}` : "Video completo (sem cortes)"}
          >
            {sourceVideoUrl}
          </SummaryPanel>

          {/* Video Preview */}
          {parsedSourceVideo && (
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold", fontSize: "0.9rem" }}>
                Previa do Video Original
              </label>
              {parsedSourceVideo.platform === "youtube" ? (
                <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", height: 0, borderRadius: "8px", overflow: "hidden", border: "1px solid var(--line)", background: "#000" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${parsedSourceVideo.externalId}`}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="YouTube Video Preview"
                  />
                </div>
              ) : parsedSourceVideo.platform === "instagram" ? (
                <div style={{ position: "relative", width: "100%", paddingBottom: "125%", height: 0, borderRadius: "8px", overflow: "hidden", border: "1px solid var(--line)", background: "#000" }}>
                  <iframe
                    src={`https://www.instagram.com/reel/${parsedSourceVideo.externalId}/embed/captioned/`}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                    frameBorder="0"
                    scrolling="no"
                    allowTransparency
                    title="Instagram Video Preview"
                  />
                </div>
              ) : (
                <video
                  src={sourceVideoUrl}
                  controls
                  style={{ width: "100%", maxHeight: "360px", borderRadius: "8px", border: "1px solid var(--line)", background: "#000" }}
                />
              )}
            </div>
          )}

          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="avatar-parent">Avatar Principal</label>
            <select
              id="avatar-parent"
              value={parentId}
              onChange={(event) => handleParentChange(event.target.value)}
              required
            >
              {mainAvatars.map((avatar) => (
                <option value={avatar.id} key={avatar.id}>
                  {avatar.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="avatar-version">Versao do Avatar</label>
            <select
              id="avatar-version"
              value={versionId}
              onChange={(event) => {
                setVersionId(event.target.value);
                setSwappedVideoFile(null);
                setNewVersionName("");
              }}
              required
            >
              {avatars.find((a) => a.id === parentId) && (
                <option value={parentId}>Padrao (original)</option>
              )}
              {avatars
                .filter((a) => a.parent_id === parentId)
                .map((version) => (
                  <option value={version.id} key={version.id}>
                    {version.name}
                  </option>
                ))}
            </select>
          </div>

          <AvatarVersionPreview avatar={selectedAvatar} />

          {/* Optional Base Video Swapping */}
          <div style={{ border: "1px dashed var(--line)", padding: 14, borderRadius: 8, marginTop: 16, background: "var(--panel-strong)" }}>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="swapped-video" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Upload size={16} /> Trocar video base para este job? (Opcional)
              </label>
              <input
                id="swapped-video"
                type="file"
                accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSwappedVideoFile(file);
                  if (file && !newVersionName) {
                    setNewVersionName(`Versao via Job - ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR").slice(0, 5)}`);
                  }
                }}
              />
              <span className="field-hint" style={{ fontSize: "0.78rem" }}>
                Selecione um novo video ou imagem para usar como base para o avatar neste job.
              </span>
            </div>

            {swappedVideoFile && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={saveAsNewVersion}
                    onChange={(e) => setSaveAsNewVersion(e.target.checked)}
                  />
                  <span>Salvar como uma nova versao do avatar principal?</span>
                </label>

                {saveAsNewVersion && (
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="new-version-name">Nome da Nova Versao</label>
                    <input
                      id="new-version-name"
                      value={newVersionName}
                      onChange={(e) => setNewVersionName(e.target.value)}
                      placeholder="Ex: Joao com terno azul"
                      required={saveAsNewVersion}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="topic">Assunto do React</label>
            <textarea
              id="topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Ex: produto viral de cozinha, trend de treino, noticia de tecnologia..."
              required
            />
          </div>

          <div className="field">
            <label htmlFor="sourceVideoTitle">Titulo de referencia do video</label>
            <input
              id="sourceVideoTitle"
              value={sourceVideoTitle}
              onChange={(event) => setSourceVideoTitle(event.target.value)}
              placeholder="Ex: Receita com frango crocante"
            />
          </div>

          {message ? <p className="form-message">{message}</p> : null}

          <div className="row-actions">
            <button className="button secondary" type="button" onClick={() => setStep(1)} disabled={isGeneratingScript}>
              Voltar
            </button>
            <button
              className="button"
              type="button"
              onClick={handleGenerateScript}
              disabled={isGeneratingScript || !topic.trim() || !avatarId}
            >
              {isGeneratingScript ? "Gerando roteiro..." : "Gerar Roteiro e Avancar"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        /* STEP 3: Script Review & Edits */
        <div>
          <SummaryPanel
            label="Revisao do roteiro e configuracoes"
            actionLabel="Alterar assunto/avatar"
            onAction={() => setStep(2)}
            disabled={isLoading}
          >
            Avatar: {selectedAvatar?.name || "Nenhum"} | Assunto: {topic}
          </SummaryPanel>

          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="scriptText">Roteiro da Dublagem (Gerado pela IA - Voce pode editar)</label>
            <textarea
              id="scriptText"
              value={scriptText}
              onChange={(e) => {
                setScriptText(e.target.value);
                setVoiceDirection(null);
              }}
              rows={6}
              placeholder="Escreva ou edite o roteiro do react..."
              required
            />
            <span className="field-hint">Este texto sera falado pelo avatar e usado no Lip-sync.</span>
            {voiceDirection?.cues.length ? (
              <div className="field-hint" style={{ marginTop: 8 }}>
                Direção vocal automática: {voiceDirection.cues.map((cue) => `${cue.effects.join(" + ")} (frase ${cue.sentence + 1})`).join(" · ")}. Ao editar o texto, a direção será recalculada antes da voz.
              </div>
            ) : (
              <div className="field-hint" style={{ marginTop: 8 }}>
                A direção vocal é decidida automaticamente pelo agente conforme o contexto do roteiro.
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="transcription">Transcricao do Video Original (IA)</label>
              <textarea
                id="transcription"
                value={sourceVideoTranscription || "Sem transcricao de audio significativa."}
                readOnly
                rows={4}
                style={{ background: "var(--panel-strong)", opacity: 0.8, fontSize: "0.86rem" }}
              />
            </div>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="description">Descricao Visual do Video (IA)</label>
              <textarea
                id="description"
                value={sourceVideoDescription || "Sem descricao visual disponivel."}
                readOnly
                rows={4}
                style={{ background: "var(--panel-strong)", opacity: 0.8, fontSize: "0.86rem" }}
              />
            </div>
          </div>

          <CompactSettingsPanel
            title="Layout e composicao"
            summary={`${layoutOptions.find((option) => option.value === renderLayout)?.label ?? "Layout"} - ${expertBackgroundMode === "remove" ? "fundo removido" : "fundo original"}`}
            icon={<Scissors size={18} />}
            open={showLayoutSettings}
            onToggle={() => setShowLayoutSettings((value) => !value)}
          >
            <div className="field" style={{ marginTop: 0 }}>
              <label>Layout do video colagem</label>
              <div className="layout-options" role="group" aria-label="Layout do video">
                {layoutOptions.map((option) => (
                  <button
                    className={`layout-option ${renderLayout === option.value ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setRenderLayout(option.value);
                      if (option.value !== "source_pip") {
                        setExpertBackgroundMode("original");
                      }
                    }}
                    key={option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="field-hint">
                {layoutOptions.find((option) => option.value === renderLayout)?.description}
              </span>
            </div>

            <div className="field">
              <label className={`toggle-row ${!canRemoveExpertBackground ? "disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={expertBackgroundMode === "remove"}
                  disabled={!canRemoveExpertBackground}
                  onChange={(event) => setExpertBackgroundMode(event.target.checked ? "remove" : "original")}
                />
                <Scissors size={18} />
                <span>Remover fundo do expert</span>
              </label>
              <span className="field-hint">Disponivel no layout Fonte cheia + expert. Exige rembg no worker.</span>
            </div>

            <div
              className={`collage-preview ${renderLayout} ${expertBackgroundMode === "remove" ? "expert-cutout" : ""}`}
              aria-label="Preview da colagem"
            >
              <div className="collage-preview-source">
                <SourceIcon size={18} />
                <span>
                  {parsedSourceVideo ? getSourceVideoPlatformLabel(parsedSourceVideo.platform) : "Instagram / YouTube / Video"}
                </span>
              </div>
              <div className="collage-preview-expert">
                <span>Expert</span>
              </div>
            </div>
          </CompactSettingsPanel>

          <CompactSettingsPanel
            title="Voz e lip-sync"
            summary={`${speed.toFixed(1).replace(".", ",")}x, ${inferenceSteps} steps, ${duration || "auto"}s`}
            icon={<Settings size={18} />}
            open={showAdvancedVoice}
            onToggle={() => setShowAdvancedVoice((value) => !value)}
          >
            <span className="field-hint" style={{ marginTop: 0 }}>
              A voz gerada por OmniVoice segue automaticamente para o lip-sync. Mantenha os defaults se nao precisar de ajuste fino.
            </span>

            {/* Inference Steps */}
            <div className="advanced-slider-group">
                  <div className="advanced-slider-header">
                    <span className="advanced-slider-label">Inference Steps</span>
                    <div className="advanced-slider-controls">
                      <span className="advanced-slider-val">{inferenceSteps}</span>
                      <button
                        type="button"
                        className="advanced-slider-reset"
                        onClick={() => setInferenceSteps(32)}
                        title="Resetar"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="advanced-slider-input-row">
                    <span className="advanced-slider-limit">8</span>
                    <input
                      type="range"
                      min="8"
                      max="64"
                      step="1"
                      value={inferenceSteps}
                      onChange={(e) => setInferenceSteps(parseInt(e.target.value))}
                    />
                    <span className="advanced-slider-limit">64</span>
                  </div>
                </div>

                {/* Guidance Scale */}
                <div className="advanced-slider-group">
                  <div className="advanced-slider-header">
                    <span className="advanced-slider-label">Guidance Scale</span>
                    <div className="advanced-slider-controls">
                      <span className="advanced-slider-val">{guidanceScale}</span>
                      <button
                        type="button"
                        className="advanced-slider-reset"
                        onClick={() => setGuidanceScale(3)}
                        title="Resetar"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="advanced-slider-input-row">
                    <span className="advanced-slider-limit">0</span>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={guidanceScale}
                      onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                    />
                    <span className="advanced-slider-limit">10</span>
                  </div>
                </div>

                {/* Denoise Ratio */}
                <div className="advanced-slider-group">
                  <div className="advanced-slider-header">
                    <span className="advanced-slider-label">Denoise Ratio</span>
                    <div className="advanced-slider-controls">
                      <span className="advanced-slider-val">{denoiseRatio.toFixed(1).replace(".", ",")}</span>
                      <button
                        type="button"
                        className="advanced-slider-reset"
                        onClick={() => setDenoiseRatio(0.8)}
                        title="Resetar"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="advanced-slider-input-row">
                    <span className="advanced-slider-limit">0</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={denoiseRatio}
                      onChange={(e) => setDenoiseRatio(parseFloat(e.target.value))}
                    />
                    <span className="advanced-slider-limit">1</span>
                  </div>
                </div>

                {/* Speed */}
                <div className="advanced-slider-group">
                  <div className="advanced-slider-header">
                    <span className="advanced-slider-label">Speed</span>
                    <div className="advanced-slider-controls">
                      <span className="advanced-slider-val">{speed.toFixed(1).replace(".", ",")}</span>
                      <button
                        type="button"
                        className="advanced-slider-reset"
                        onClick={() => setSpeed(1)}
                        title="Resetar"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="advanced-slider-input-row">
                    <span className="advanced-slider-limit">0.5</span>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    />
                    <span className="advanced-slider-limit">2</span>
                  </div>
                </div>

                {/* Duration */}
                <div className="advanced-slider-group">
                  <div className="advanced-slider-header">
                    <span className="advanced-slider-label">Duration (0 = auto)</span>
                    <div className="advanced-slider-controls">
                      <span className="advanced-slider-val">{duration}</span>
                      <button
                        type="button"
                        className="advanced-slider-reset"
                        onClick={() => setDuration(0)}
                        title="Resetar"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="advanced-slider-input-row">
                    <span className="advanced-slider-limit">0</span>
                    <input
                      type="range"
                      min="0"
                      max="30"
                      step="1"
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value))}
                    />
                    <span className="advanced-slider-limit">30</span>
                  </div>
                </div>

                {/* Checkboxes Row */}
            <div className="advanced-checkboxes-row">
              <label className="advanced-checkbox-item">
                <input
                  type="checkbox"
                  checked={preprocessPrompt}
                  onChange={(e) => setPreprocessPrompt(e.target.checked)}
                />
                <span>Preprocess Prompt</span>
              </label>
              <label className="advanced-checkbox-item">
                <input
                  type="checkbox"
                  checked={postprocessOutput}
                  onChange={(e) => setPostprocessOutput(e.target.checked)}
                />
                <span>Postprocess Output</span>
              </label>
            </div>
          </CompactSettingsPanel>

          {message ? <p className="form-message">{message}</p> : null}

          <div className="row-actions">
            <button className="button secondary" type="button" onClick={() => setStep(2)} disabled={isLoading}>
              Voltar
            </button>
            <button className="button" type="submit" disabled={isLoading}>
              <Rocket size={18} /> {isLoading ? "Criando e Renderizando..." : "Criar e Iniciar Renderizacao"}
            </button>
          </div>
        </div>
      )}

      {trackedJob ? (
        <GenerationTracker
          job={trackedJob}
          events={trackedEvents}
          isRefreshing={isRefreshingJob}
          isRestarting={isRestartingJob}
          onRefresh={() => void refreshTrackedJob(trackedJob.id)}
          onRestart={(startFrom) => void handleRestartJob(startFrom)}
        />
      ) : null}
    </form>
  );
}
