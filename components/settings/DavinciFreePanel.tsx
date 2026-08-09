"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CheckCircle,
  Download,
  Film,
  FolderSearch,
  ListVideo,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  WandSparkles,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Scissors,
  Plus,
  ZoomIn,
  ZoomOut,
  Folder,
  FolderOpen,
  Palette,
  Subtitles,
  Video,
  Search,
} from "lucide-react";
import { GoogleDriveVideoControls, pickGoogleDriveFolder } from "@/components/video/GoogleDriveVideoControls";
import {
  VideoEditorConsole,
  type ConsoleLogEntry,
  type ConsoleLogLevel,
} from "@/components/video/video-editor-console";
import type {
  GoogleDriveConnectionStatus,
  GoogleDriveCourseManifest,
  GoogleDriveSelection,
} from "@/services/google-drive/google-drive.types";

type Status = {
  runnerInstalled: boolean;
  runnerDirectory: string;
  pendingPlan: null | { requestId: string; timelineName: string; createdAt: string };
  latestResult: null | Record<string, unknown>;
  instructions: string[];
};

type EditEvent = {
  id: string;
  kind:
    | "intro"
    | "outro"
    | "lower-third"
    | "impact-text"
    | "zoom"
    | "cut"
    | "cursor"
    | "transition"
    | "meme-sfx";
  start: number;
  duration: number;
  label: string;
  subtitle?: string;
  reason: string;
  scale?: number;
  x?: number;
  y?: number;
};

type EditorialReview = {
  captionsEnabled?: boolean;
  events: Array<Partial<EditEvent> & { id: string; enabled?: boolean }>;
  addedEvents?: EditEvent[];
  captions: Array<{ index: number; enabled?: boolean; start?: number; end?: number; text?: string }>;
};

type Analysis = {
  id: string;
  sourcePath: string;
  courseName?: string;
  moduleName: string;
  media: {
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    musicPath?: string;
    musicDb: number;
  };
  transcript: Array<{ start: number; end: number; text: string }>;
  captions: Array<{ start: number; end: number; text: string }>;
  events: EditEvent[];
  cursorAnalysis: { status: string; message: string };
  visual: { source: "agent-contact-sheet" | "safe-center-fallback"; sampledFrames: number };
  semantic: { source: "agent" | "deterministic-fallback"; provider?: string; model?: string };
  design?: {
    palette: "kaoz" | "electric" | "premium" | "coral" | "course-theme";
    captionsEnabled: boolean;
    colors: Record<string, string>;
  };
  courseTheme?: {
    id: string;
    key: string;
    label: string;
    rationale: string;
    tone: string;
    reused: boolean;
  };
  artifacts: { previewPath?: string; captionsPath: string; planPath: string };
};

type BatchDiscovery = {
  folderPath: string;
  suggestedCourseName: string;
  total: number;
  videos: Array<{
    index: number;
    sourcePath: string;
    relativePath: string;
    moduleName: string;
  }>;
};

type BatchJob = {
  id: string;
  version?: 1 | 2;
  status: "queued" | "running" | "cancelled" | "completed" | "completed-with-errors";
  source?: { type: "local" } | { type: "google-drive"; manifestId: string; rootFolderName: string };
  folderPath: string;
  courseName: string;
  total: number;
  completed: number;
  failed: number;
  outputFolderUrl?: string;
  moduleIdentities?: Record<string, { title: string }>;
  error?: string;
  currentItemId?: string;
  courseIdentity?: {
    title: string;
    eyebrow: string;
    promise: string;
    layout: "roadmap" | "framework" | "editorial";
    source: "agent" | "deterministic-fallback";
  };
  items: Array<{
    id: string;
    index: number;
    relativePath: string;
    moduleName: string;
    lessonName?: string;
    moduleId?: string;
    status: "pending" | "downloading" | "analyzing" | "rendering" | "uploading" | "completed" | "failed" | "cancelled";
    previewPath?: string;
    remoteOutputUrl?: string;
    bytesTransferred?: number;
    totalBytes?: number;
    error?: string;
  }>;
};

type Props = {
  onStatusMessage: (message: { text: string; type: "success" | "error" | "info" }) => void;
};

const fieldClass =
  "w-full rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all duration-200";

const kindLabel: Record<EditEvent["kind"], string> = {
  intro: "Intro",
  outro: "Encerramento",
  "lower-third": "Lower third",
  "impact-text": "Texto de impacto",
  zoom: "Zoom",
  cut: "Corte de plano",
  cursor: "Cursor",
  transition: "Transição",
  "meme-sfx": "Efeito Meme 🤡",
};

const kindColorClass: Record<EditEvent["kind"], string> = {
  intro: "bg-emerald-950/90 border-emerald-500 text-emerald-300",
  outro: "bg-indigo-950/90 border-indigo-500 text-indigo-300",
  "lower-third": "bg-violet-950/90 border-violet-500 text-violet-300",
  "impact-text": "bg-cyan-950/90 border-cyan-500 text-cyan-300",
  zoom: "bg-amber-950/90 border-amber-500 text-amber-300",
  cut: "bg-zinc-800 border-zinc-500 text-zinc-300",
  cursor: "bg-blue-950/90 border-blue-500 text-blue-300",
  transition: "bg-pink-950/90 border-pink-500 text-pink-300",
  "meme-sfx": "bg-yellow-950/90 border-yellow-400 text-yellow-300",
};

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function driveBatchConnectionError(connection: GoogleDriveConnectionStatus | null) {
  if (connection?.batchReady) return "";
  return connection?.connected
    ? "Reconecte o Google Drive nas Configurações para autorizar o processamento em lote."
    : "Conecte o Google Drive nas Configurações primeiro.";
}

function caughtMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function waveformBarHeight(peak: number, maximumPercent: number) {
  return peak <= 0 ? "1px" : `${Math.max(4, peak * maximumPercent)}%`;
}

export function DavinciFreePanel({ onStatusMessage }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [review, setReview] = useState<EditorialReview>({ events: [], captions: [] });
  const [batchFolder, setBatchFolder] = useState("");
  const [batchDiscovery, setBatchDiscovery] = useState<BatchDiscovery | null>(null);
  const [batch, setBatch] = useState<BatchJob | null>(null);
  const [batchSource, setBatchSource] = useState<"local" | "google-drive">("local");
  const [driveBatchDiscovery, setDriveBatchDiscovery] = useState<GoogleDriveCourseManifest | null>(null);
  const [selectedLocalVideos, setSelectedLocalVideos] = useState<string[]>([]);
  const [selectedDriveLessons, setSelectedDriveLessons] = useState<string[]>([]);
  const [batchSearchQuery, setBatchSearchQuery] = useState<string>("");
  const [downloadFolder, setDownloadFolder] = useState<string>("");
  const [driveConnection, setDriveConnection] = useState<GoogleDriveConnectionStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<"single" | "batch">("single");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [timelineScale, setTimelineScale] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playerDuration, setPlayerDuration] = useState<number>(0);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [musicWaveform, setMusicWaveform] = useState<number[]>([]);
  const [waveformBusy, setWaveformBusy] = useState<boolean>(false);
  const [previewStale, setPreviewStale] = useState<boolean>(false);
  const [driveSourceOrigin, setDriveSourceOrigin] = useState<GoogleDriveSelection | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([
    {
      id: "init-1",
      timestamp: new Date().toLocaleTimeString("pt-BR"),
      level: "info",
      message: "Estúdio de Edição e Orquestrador inicializados.",
      details: "Transcrição offline Parakeet/Whisper ativada. Suporte estendido a vídeos de longa duração.",
    },
  ]);

  const addLog = useCallback((level: ConsoleLogLevel, message: string, details?: string) => {
    const timestamp = new Date().toLocaleTimeString("pt-BR");
    setConsoleLogs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), timestamp, level, message, details },
    ]);
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);

  const [form, setForm] = useState({
    sourcePath: "",
    courseName: "",
    moduleName: "Módulo 1 — Boas-vindas",
    style: "balanced",
    captionsEnabled: true,
    reuseCourseTheme: true,
    musicPath: "",
    musicDb: "-38",
    sfxEnabled: true,
    sfxVolumeDb: "-12",
    sfxPack: "dynamic" as "minimal" | "dynamic" | "tech",
    outputResolution: "full-hd" as "full-hd" | "source",
    videoEncoder: "auto" as "auto" | "cpu",
  });

  const refresh = useCallback(async () => {
    const response = await fetch("/api/davinci-free", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao consultar o Resolve Free.");
    setStatus(data);
  }, []);

  useEffect(() => {
    refresh().catch((error) =>
      onStatusMessage({ text: String(error), type: "error" }),
    );
  }, [onStatusMessage, refresh]);

  const refreshDriveConnection = useCallback(async () => {
    const response = await fetch("/api/google-drive", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao consultar o Google Drive.");
    setDriveConnection(data.status || null);
    return data.status as GoogleDriveConnectionStatus | null;
  }, []);

  useEffect(() => {
    refreshDriveConnection().catch(() => undefined);
  }, [refreshDriveConnection]);

  const fetchBatch = useCallback(async (batchId?: string) => {
    const response = await fetch("/api/davinci-free", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "batch-status", batchId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao consultar o lote.");
    if (data?.id) {
      const restored = data as BatchJob;
      setBatch(restored);
      if (!batchId) {
        setBatchSource(restored.source?.type === "google-drive" ? "google-drive" : "local");
        setBatchFolder(restored.source?.type === "google-drive" ? restored.source.rootFolderName : restored.folderPath);
      }
      setForm((current) => ({
        ...current,
        courseName: restored.courseName,
      }));
    }
    return data as BatchJob | null;
  }, []);

  useEffect(() => {
    fetchBatch().catch(() => undefined);
  }, [fetchBatch]);

  useEffect(() => {
    if (!batch || !["queued", "running"].includes(batch.status)) return;
    const timer = window.setInterval(() => {
      fetchBatch(batch.id).catch((error) =>
        onStatusMessage({ text: String(error), type: "error" }),
      );
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [batch, fetchBatch, onStatusMessage]);

  async function action(name: string, payload: Record<string, unknown>) {
    setBusy(name);
    try {
      const response = await fetch("/api/davinci-free", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: name, ...payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ação não concluída.");
      await refresh();
      return data;
    } catch (error) {
      onStatusMessage({
        text: error instanceof Error ? error.message : String(error),
        type: "error",
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    addLog("info", "Iniciando análise inteligente do áudio e vídeo...", form.sourcePath ? `Caminho: ${form.sourcePath}` : "Google Drive");
    const result = await action("analyze", {
      requestId: `analysis-${crypto.randomUUID()}`,
      sourcePath: form.sourcePath,
      sourceOrigin: driveSourceOrigin ? { ...driveSourceOrigin, provider: "google-drive" } : undefined,
      courseName: form.courseName,
      moduleName: form.moduleName,
      style: form.style,
      captionsEnabled: form.captionsEnabled,
      reuseCourseTheme: form.reuseCourseTheme,
      musicPath: form.musicPath,
      musicDb: Number(form.musicDb),
      sfxEnabled: form.sfxEnabled,
      sfxVolumeDb: Number(form.sfxVolumeDb),
      sfxPack: form.sfxPack,
      useAgent: true,
    });
    if (result?.id) {
      setAnalysis(result as Analysis);
      setReview({ events: [], captions: [] });
      setPlayheadTime(0);
      setPlayerDuration(0);
      setPreviewStale(false);
      addLog(
        "success",
        "Análise e transcrição concluídas!",
        `ID do Plano: ${result.id} | Segundos: ${result.media?.durationSeconds || 0}s`,
      );
      onStatusMessage({
        text: "Áudio transcrito e decisões de edição preparadas para revisão.",
        type: "success",
      });
    } else {
      addLog("error", "Análise não pôde ser concluída.");
    }
  }

  async function renderPreview() {
    if (!analysis) return;
    addLog("info", "Salvando revisão e iniciando renderização de vídeo FFmpeg...", `Plano ID: ${analysis.id}`);
    const saved = await action("save-editorial-review", { planId: analysis.id, review });
    if (!saved) {
      addLog("error", "Falha ao salvar a revisão editorial.");
      return;
    }
    addLog("ffmpeg", "Executando codificação H.264 / AAC com legendas dinamicas e cartões de introdução...");
    const result = await action("render-preview", {
      planId: analysis.id,
      outputResolution: form.outputResolution,
      videoEncoder: form.videoEncoder,
    });
    if (result?.plan) {
      setAnalysis(result.plan as Analysis);
      setPlayheadTime(0);
      setPlayerDuration(Number(result.durationSeconds) || 0);
      setPreviewStale(false);
      addLog(
        "success",
        "Vídeo renderizado e pronto para reprodução!",
        `Arquivo de vídeo: ${String(result.previewPath)} | Saída: ${Number(result.outputResolution?.width)}x${Number(result.outputResolution?.height)} | Encoder: ${String(result.videoEncoder?.used)}`,
      );
      onStatusMessage({
        text: `Prévia renderizada em ${String(result.previewPath)}`,
        type: "success",
      });
    } else {
      addLog("error", "Erro ao renderizar o vídeo com FFmpeg.");
    }
  }

  function eventReview(event: EditEvent) {
    return review.events.find((item) => item.id === event.id) || { id: event.id };
  }

  function updateEvent(event: EditEvent, patch: Partial<EditEvent> & { enabled?: boolean }) {
    setPreviewStale(true);
    if (event.id.startsWith("custom-evt-")) {
      if (patch.enabled === false) {
        setAnalysis((current) => current ? {
          ...current,
          events: current.events.filter((item) => item.id !== event.id),
        } : null);
        setReview((current) => ({
          ...current,
          addedEvents: (current.addedEvents || []).filter((item) => item.id !== event.id),
        }));
        setSelectedEventId(null);
        return;
      }
      const { enabled: _enabled, ...eventPatch } = patch;
      setAnalysis((current) => current ? {
        ...current,
        events: current.events.map((item) =>
          item.id === event.id ? { ...item, ...eventPatch } : item
        ),
      } : null);
      setReview((current) => ({
        ...current,
        addedEvents: (current.addedEvents || []).map((item) =>
          item.id === event.id ? { ...item, ...eventPatch } : item
        ),
      }));
      return;
    }
    setReview((current) => ({
      ...current,
      events: [...current.events.filter((item) => item.id !== event.id), { ...eventReview(event), ...patch, id: event.id }],
    }));
  }

  function captionReview(index: number) {
    return review.captions.find((item) => item.index === index) || { index };
  }

  function updateCaption(index: number, patch: Partial<EditorialReview["captions"][number]>) {
    setPreviewStale(true);
    setReview((current) => ({
      ...current,
      captions: [...current.captions.filter((item) => item.index !== index), { ...captionReview(index), ...patch, index }],
    }));
  }

  async function restoreAutomatic() {
    if (!analysis) return;
    const result = await action("reset-editorial-review", { planId: analysis.id });
    if (result) {
      setAnalysis(result as Analysis);
      setReview({ events: [], captions: [] });
      setPreviewStale(true);
      onStatusMessage({ text: "Decisões automáticas restauradas. Renderize a prévia quando quiser conferir.", type: "success" });
    }
  }

  async function saveCourseStandard() {
    if (!analysis) return;
    const saved = await action("save-editorial-review", { planId: analysis.id, review });
    if (!saved) return;
    const result = await action("save-course-editorial-standard", { planId: analysis.id });
    if (result) onStatusMessage({ text: "Padrão editorial salvo para as próximas aulas do curso.", type: "success" });
  }

  async function approve() {
    if (!analysis) return;
    const result = await action("approve-intelligent", {
      requestId: `approved-${crypto.randomUUID()}`,
      planId: analysis.id,
    });
    if (result?.requestId) {
      onStatusMessage({
        text: "Prévia aprovada. Agora execute o script Kaoz.1 dentro do Resolve.",
        type: "success",
      });
    }
  }

  async function archivePending() {
    const result = await action("archive-pending", {
      requestId: `archive-${crypto.randomUUID()}`,
    });
    if (result?.archived) {
      onStatusMessage({
        text: "Plano anterior arquivado com segurança.",
        type: "success",
      });
    }
  }

  async function discoverBatch() {
    setDriveBatchDiscovery(null);
    let folderPath = "";
    if (window.kaoz1Desktop?.chooseCourseFolder) {
      const selected = await window.kaoz1Desktop.chooseCourseFolder();
      if (!selected) return;
      folderPath = selected;
      setBatchFolder(selected);
      setBatchDiscovery(null);
    } else {
      const selected = await action("choose-folder", {});
      if (!selected?.folderPath) return;
      folderPath = String(selected.folderPath);
      setBatchFolder(folderPath);
      setBatchDiscovery(null);
    }
    const result = await action("discover-batch", { folderPath });
    if (result?.videos) {
      const discovery = result as BatchDiscovery;
      setBatchDiscovery(discovery);
      setSelectedLocalVideos(discovery.videos.map((v) => v.relativePath));
      setForm((current) => ({
        ...current,
        courseName: discovery.suggestedCourseName,
      }));
      onStatusMessage({
        text: `${String(result.total)} aulas encontradas. Selecione as aulas desejadas antes de iniciar.`,
        type: "info",
      });
    }
  }

  async function chooseDownloadFolder() {
    let folder = "";
    if (window.kaoz1Desktop?.chooseCourseFolder) {
      const selected = await window.kaoz1Desktop.chooseCourseFolder();
      if (!selected) return;
      folder = selected;
    } else {
      const selected = await action("choose-folder", {});
      if (!selected?.folderPath) return;
      folder = String(selected.folderPath);
    }
    setDownloadFolder(folder);
    onStatusMessage({ text: `Pasta de download local alterada para: ${folder}`, type: "info" });
  }

  async function discoverDriveBatch() {
    const connection = await refreshDriveConnection();
    const connectionError = driveBatchConnectionError(connection);
    if (connectionError) {
      onStatusMessage({ text: connectionError, type: "error" });
      return;
    }
    setBusy("drive-picker");
    try {
      const selected = await pickGoogleDriveFolder();
      if (!selected?.id) return;
      setBatchFolder(selected.name ?? "Pasta do Google Drive");
      setBatchDiscovery(null);
      const result = await action("discover-drive-batch", { rootFolderId: selected.id, downloadFolder: downloadFolder || undefined });
      if (!result?.id) return;
      const discovery = result as GoogleDriveCourseManifest;
      setDriveBatchDiscovery(discovery);
      setSelectedDriveLessons(discovery.lessons.map((l) => l.id));
      setForm((current) => ({ ...current, courseName: discovery.root.name }));
      if (!discovery.valid) {
        onStatusMessage({ text: "A estrutura do curso possui erros. Corrija as aulas indicadas antes de iniciar.", type: "error" });
        return;
      }
      onStatusMessage({
        text: `${discovery.lessons.length} aulas encontradas no Drive. Selecione as aulas desejadas antes de iniciar.`,
        type: "info",
      });
    } catch (error) {
      onStatusMessage({ text: caughtMessage(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function startDriveBatch(discovery = driveBatchDiscovery, selectedIds = selectedDriveLessons) {
    if (!discovery) return;
    if (selectedIds.length === 0) {
      onStatusMessage({ text: "Selecione pelo menos uma aula para exportar.", type: "error" });
      return;
    }
    setBusy("start-batch");
    try {
      const result = await action("start-batch", {
        requestId: `course-drive-batch-${crypto.randomUUID()}`,
        manifestId: discovery.id,
        courseName: discovery.root.name,
        style: form.style,
        captionsEnabled: form.captionsEnabled,
        musicPath: form.musicPath,
        musicDb: Number(form.musicDb),
        useAgent: true,
        selectedItemIds: selectedIds,
        downloadFolder: downloadFolder || undefined,
        outputResolution: form.outputResolution,
        videoEncoder: form.videoEncoder,
      });
      if (result?.id) {
        setBatch(result as BatchJob);
        onStatusMessage({ text: `Lote do Drive iniciado com ${selectedIds.length} aula(s) selecionada(s).`, type: "success" });
      }
    } catch (error) {
      onStatusMessage({ text: caughtMessage(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function startBatch(folderPath = batchFolder, courseName = form.courseName, selectedPaths = selectedLocalVideos) {
    if (selectedPaths.length === 0) {
      onStatusMessage({ text: "Selecione pelo menos um vídeo para exportar.", type: "error" });
      return;
    }
    setBusy("start-batch");
    try {
      const result = await action("start-batch", {
        requestId: `course-batch-${crypto.randomUUID()}`,
        folderPath,
        courseName,
        style: form.style,
        captionsEnabled: form.captionsEnabled,
        musicPath: form.musicPath,
        musicDb: Number(form.musicDb),
        useAgent: true,
        selectedRelativePaths: selectedPaths,
        outputResolution: form.outputResolution,
        videoEncoder: form.videoEncoder,
      });
      if (result?.id) {
        setBatch(result as BatchJob);
        onStatusMessage({
          text: `Lote iniciado com ${selectedPaths.length} vídeo(s) selecionado(s). O processamento continuará em segundo plano.`,
          type: "success",
        });
      }
    } catch (error) {
      onStatusMessage({ text: caughtMessage(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function retryBatch() {
    if (!batch) return;
    const result = await action("retry-batch", { batchId: batch.id });
    if (result?.id) setBatch(result as BatchJob);
  }

  async function changeBatchState(actionName: "cancel-batch" | "resume-batch") {
    if (!batch) return;
    const result = await action(actionName, { batchId: batch.id });
    if (result?.id) setBatch(result as BatchJob);
  }

  const eventCounts = useMemo(() => {
    const counts: Partial<Record<EditEvent["kind"], number>> = {};
    for (const event of analysis?.events || []) {
      counts[event.kind] = (counts[event.kind] || 0) + 1;
    }
    return counts;
  }, [analysis]);

  const activeMediaAsset = analysis?.artifacts.previewPath ? "preview" : "source";
  const timelineDuration = useMemo(() => {
    if (playerDuration > 0) return playerDuration;
    if (analysis?.media.durationSeconds) {
      return analysis.media.durationSeconds + (activeMediaAsset === "preview" ? 8 : 0);
    }
    return 1;
  }, [activeMediaAsset, analysis?.media.durationSeconds, playerDuration]);

  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const visibleDuration = timelineDuration / timelineScale;
    const step = visibleDuration > 300 ? 60 : visibleDuration > 120 ? 30 : visibleDuration > 60 ? 15 : 5;
    for (let i = 0; i <= timelineDuration; i += step) {
      ticks.push(i);
    }
    const lastWholeSecond = Math.floor(timelineDuration);
    if (ticks.at(-1) !== lastWholeSecond) ticks.push(lastWholeSecond);
    return ticks;
  }, [timelineDuration, timelineScale]);

  const videoMediaSrc = useMemo(() => {
    if (!analysis) return "";
    return `/api/davinci-free/media?planId=${analysis.id}&asset=${activeMediaAsset}`;
  }, [activeMediaAsset, analysis]);
  const waveformPointCount = Math.min(720, Math.round(360 * timelineScale));

  useEffect(() => {
    setPlayerDuration(0);
    setPlayerError(null);
    setPlayheadTime(0);
  }, [videoMediaSrc]);

  useEffect(() => {
    if (!analysis) {
      setWaveform([]);
      setMusicWaveform([]);
      return;
    }
    const controller = new AbortController();
    setWaveformBusy(true);
    const load = async (asset: "source" | "preview" | "music") => {
      const response = await fetch(
        `/api/davinci-free/media?planId=${analysis.id}&asset=${asset}&waveform=true&points=${waveformPointCount}`,
        { cache: "no-store", signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao ler a faixa de áudio.");
      return Array.isArray(data.peaks) ? data.peaks as number[] : [];
    };
    Promise.all([
      load(activeMediaAsset).then(setWaveform),
      analysis.media.musicPath
        ? load("music").then(setMusicWaveform)
        : Promise.resolve(setMusicWaveform([])),
    ])
      .catch((error) => {
        if (!controller.signal.aborted) {
          setWaveform([]);
          onStatusMessage({
            text: error instanceof Error ? error.message : String(error),
            type: "error",
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setWaveformBusy(false);
      });
    return () => controller.abort();
  }, [activeMediaAsset, analysis, onStatusMessage, waveformPointCount]);

  function eventPlayerTime(event: EditEvent, sourceTime: number) {
    if (activeMediaAsset !== "preview") return sourceTime;
    if (event.kind === "intro") return 0;
    if (event.kind === "outro") return (analysis?.media.durationSeconds || sourceTime) + 4;
    return sourceTime + 4;
  }

  function handleSelectEvent(eventId: string, time: number) {
    setSelectedEventId(eventId);
    setPlayheadTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    const element = document.getElementById(`edit-${eventId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function handleTimelineClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!timelineTrackRef.current) return;
    const rect = timelineTrackRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const ratio = clickX / rect.width;
    const newTime = Math.round(ratio * timelineDuration * 10) / 10;
    setPlayheadTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  }

  function addEventAtPlayhead() {
    if (!analysis) return;
    const newId = `custom-evt-${crypto.randomUUID().slice(0, 8)}`;
    const sourceTime = activeMediaAsset === "preview"
      ? Math.max(0, Math.min(analysis.media.durationSeconds, playheadTime - 4))
      : Math.min(analysis.media.durationSeconds, playheadTime);
    const newEvent: EditEvent = {
      id: newId,
      kind: "impact-text",
      start: Math.round(sourceTime * 10) / 10,
      duration: 2.5,
      label: "Novo Destaque",
      reason: "Evento adicionado manualmente na timeline",
    };
    setAnalysis((current) => current ? {
      ...current,
      events: [...current.events, newEvent],
    } : null);
    setReview((current) => ({
      ...current,
      addedEvents: [...(current.addedEvents || []), newEvent],
    }));
    setPreviewStale(true);
    setSelectedEventId(newId);
    onStatusMessage({ text: `Novo evento inserido em ${clock(sourceTime)}`, type: "success" });
  }

  function togglePlayPause() {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => undefined);
    }
    setIsPlaying(!isPlaying);
  }

  function toggleMute() {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  }

  function toggleFullscreen() {
    videoRef.current?.requestFullscreen().catch(() => undefined);
  }

  const update =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  // Dynamic presenter anchor coordinates
  const selectedEvent = useMemo(() => {
    return analysis?.events.find((e) => e.id === selectedEventId) || null;
  }, [analysis, selectedEventId]);

  return (
    <div className="space-y-4 pb-20">
      {/* Workstation Header Bar (Stitch TopNavBar) */}
      <header className="relative flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900/80 px-5 py-3.5 backdrop-blur-xl shadow-xl">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
              <Video size={16} />
            </span>
            <span className="font-extrabold text-base tracking-tight text-white">AIVideoPro</span>
          </div>

          {/* Mode Switcher Tabs */}
          <nav className="flex items-center gap-1 rounded-xl bg-black/40 p-1 border border-white/10">
            <button
              onClick={() => setActiveMode("single")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                activeMode === "single"
                  ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <Film size={14} />
              Single Edit (Aula Única)
            </button>
            <button
              onClick={() => setActiveMode("batch")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                activeMode === "batch"
                  ? "bg-violet-500 text-white shadow-md shadow-violet-500/20"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <ListVideo size={14} />
              Batch Processing (Lote)
            </button>
          </nav>
        </div>

        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border ${
              status?.runnerInstalled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status?.runnerInstalled ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
            />
            {status?.runnerInstalled ? "Runner: Online" : "Runner ainda não instalado"}
          </span>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium text-cyan-300">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            Resolve: Conectado
          </span>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold text-violet-300">
            <Sparkles size={13} className="text-violet-400" />
            AI: Ativo
          </span>

          <button
            onClick={() => refresh()}
            className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition-all"
            title="Atualizar"
          >
            <RefreshCw size={14} className={busy === "refresh" ? "animate-spin text-emerald-400" : ""} />
          </button>
        </div>
      </header>

      {/* Editor inteligente para DaVinci Resolve Free Banner */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-xs flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold text-zinc-100 text-xs">
          <Sparkles size={15} className="text-emerald-400" />
          Editor inteligente para DaVinci Resolve Free
        </h2>
        <span className={status?.runnerInstalled ? "text-emerald-400 text-[11px]" : "text-amber-400 text-[11px]"}>
          {status?.runnerInstalled ? "● Runner instalado" : "● Runner ainda não instalado"}
        </span>
      </div>

      {!status?.runnerInstalled && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <span className="text-xs text-amber-200">
            O runner interno do Resolve ainda não foi instalado no sistema.
          </span>
          <button
            disabled={!!busy}
            onClick={() =>
              action("install", { requestId: `install-${crypto.randomUUID()}` })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-50"
          >
            {busy === "install" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            Instalar runner no Resolve
          </button>
        </div>
      )}

      {/* Visão de Aula Única (Workstation 3-Pane) */}
      {activeMode === "single" && (
        <div className="grid items-start gap-4 lg:grid-cols-12">
          {/* PAINEL ESQUERDO: SideNavBar / Project Config */}
          <aside className="lg:col-span-3 flex flex-col rounded-2xl border border-white/10 bg-zinc-900/70 p-4 backdrop-blur-xl shadow-xl space-y-4">
            <div className="border-b border-white/10 pb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <Folder size={14} />
                Project Config
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">Configuração da Aula Única</p>
            </div>

            <div className="space-y-3.5 flex-1 overflow-y-auto pr-1 text-xs">
              {/* Video Metadata */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block border-b border-white/5 pb-1">
                  Video Metadata
                </span>
                <label className="block space-y-1 text-zinc-300 font-semibold">
                  Vídeo da aula
                  <div className="flex items-center gap-2">
                    <input
                      className={fieldClass}
                      placeholder="C:\Videos\aula.mp4"
                      value={form.sourcePath}
                      onChange={(event) => {
                        setDriveSourceOrigin(null);
                        setForm((current) => ({ ...current, sourcePath: event.target.value }));
                      }}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        let selectedPath = "";
                        if (window.kaoz1Desktop?.chooseCourseFolder) {
                          selectedPath = (await window.kaoz1Desktop.chooseCourseFolder()) || "";
                        } else {
                          const selected = await action("choose-folder", {});
                          if (selected?.folderPath) {
                            selectedPath = String(selected.folderPath);
                          }
                        }
                        if (selectedPath) {
                          setDriveSourceOrigin(null);
                          setForm((current) => ({ ...current, sourcePath: selectedPath }));
                          addLog("info", "Vídeo / Pasta selecionado:", selectedPath);
                          onStatusMessage({
                            text: `Caminho selecionado: ${selectedPath}`,
                            type: "info",
                          });
                        }
                      }}
                      className="inline-flex items-center gap-1.5 shrink-0 rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-900/80 hover:border-emerald-400 transition-all duration-200 cursor-pointer shadow-lg shadow-emerald-950/40 active:scale-95"
                      title="Clique para abrir o seletor nativo e escolher o arquivo de vídeo ou pasta da aula"
                    >
                      <FolderOpen size={14} className="text-emerald-400" />
                      <span>Selecionar Pasta</span>
                    </button>
                  </div>
                </label>

                <GoogleDriveVideoControls
                  planId={analysis?.id}
                  renderReady={Boolean(analysis?.artifacts.previewPath) && !previewStale}
                  onImported={(localPath, selection) => {
                    setDriveSourceOrigin(selection);
                    setForm((current) => ({
                      ...current,
                      sourcePath: localPath,
                      moduleName: current.moduleName || selection.name.replace(/\.[^.]+$/, ""),
                    }));
                  }}
                  onStatusMessage={onStatusMessage}
                />

                <label className="block space-y-1 text-zinc-300 font-semibold">
                  Nome do curso (identidade compartilhada)
                  <input className={fieldClass} value={form.courseName} onChange={update("courseName")} />
                </label>

                <label className="block space-y-1 text-zinc-300 font-semibold">
                  Nome do módulo
                  <input className={fieldClass} value={form.moduleName} onChange={update("moduleName")} />
                </label>
              </div>

              {/* Edit Style */}
              <div className="space-y-2 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block border-b border-white/5 pb-1 flex items-center gap-1">
                  <Palette size={12} /> Edit Style
                </span>
                <label className="block space-y-1 text-zinc-300 font-semibold">
                  Estilo / Ritmo
                  <select className={fieldClass} value={form.style} onChange={update("style")}>
                    <option value="subtle">Discreto (Subtle)</option>
                    <option value="balanced">Equilibrado (Balanced)</option>
                    <option value="dynamic">Dinâmico (Dynamic)</option>
                    <option value="meme">🤡 Modo Meme (Edição Cômica)</option>
                  </select>
                </label>

                <label className="block space-y-1 text-zinc-300 font-semibold">
                  Resolução de saída
                  <select
                    className={fieldClass}
                    value={form.outputResolution}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      outputResolution: event.target.value as "full-hd" | "source",
                    }))}
                  >
                    <option value="full-hd">Full HD (recomendado)</option>
                    <option value="source">Manter resolução original</option>
                  </select>
                  <span className="block text-[10px] font-normal leading-tight text-zinc-500">
                    Full HD reduz vídeos 4K para até 1920×1080 (ou 1080×1920 em retrato), sem ampliar arquivos menores.
                  </span>
                </label>

                <label className="block space-y-1 text-zinc-300 font-semibold">
                  Codificação de vídeo
                  <select
                    className={fieldClass}
                    value={form.videoEncoder}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      videoEncoder: event.target.value as "auto" | "cpu",
                    }))}
                  >
                    <option value="auto">GPU AMD automática (rápida)</option>
                    <option value="cpu">CPU libx264 (compatibilidade)</option>
                  </select>
                  <span className="block text-[10px] font-normal leading-tight text-zinc-500">
                    O modo automático usa AMD AMF e retorna para CPU se a aceleração não estiver disponível.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-black/40 p-2.5 text-zinc-300 cursor-pointer hover:border-white/20 transition-all">
                  <input
                    type="checkbox"
                    checked={form.reuseCourseTheme}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reuseCourseTheme: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded accent-emerald-500"
                  />
                  <span>
                    <strong className="block text-zinc-100 font-bold text-[11px]">Manter identidade do curso</strong>
                    <span className="text-[10px] text-zinc-400 leading-tight block">
                      Reutiliza o tema visual nas próximas aulas.
                    </span>
                  </span>
                </label>
              </div>

              {/* Audio & Captions */}
              <div className="space-y-2 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block border-b border-white/5 pb-1 flex items-center gap-1">
                  <Subtitles size={12} /> Audio & Captions
                </span>

                <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-black/40 p-2.5 text-zinc-300 cursor-pointer hover:border-white/20 transition-all">
                  <input
                    type="checkbox"
                    checked={form.captionsEnabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        captionsEnabled: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded accent-emerald-500"
                  />
                  <span>
                    <strong className="block text-zinc-100 font-bold text-[11px]">Incluir legendas no vídeo</strong>
                    <span className="text-[10px] text-zinc-400 leading-tight block">
                      Transcrição analisada mesmo com legendas desativadas.
                    </span>
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="space-y-1 text-zinc-400 font-medium">
                    Música opcional
                    <input className={fieldClass} value={form.musicPath} onChange={update("musicPath")} />
                  </label>
                  <label className="space-y-1 text-zinc-400 font-medium">
                    Volume Música (dB)
                    <input className={fieldClass} value={form.musicDb} onChange={update("musicDb")} />
                  </label>
                </div>

                <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-black/40 p-2.5 text-zinc-300 cursor-pointer hover:border-white/20 transition-all">
                  <input
                    type="checkbox"
                    checked={form.sfxEnabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        sfxEnabled: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded accent-emerald-500"
                  />
                  <span>
                    <strong className="block text-zinc-100 font-bold text-[11px]">Efeitos sonoros imersivos (SFX)</strong>
                    <span className="text-[10px] text-zinc-400 leading-tight block">
                      Dispara sons de whoosh, pop e chime em transições e cartões.
                    </span>
                  </span>
                </label>

                {form.sfxEnabled && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="space-y-1 text-zinc-400 font-medium">
                      Estilo de SFX
                      <select
                        className={fieldClass}
                        value={form.sfxPack}
                        onChange={(e) => setForm((current) => ({ ...current, sfxPack: e.target.value as "minimal" | "dynamic" | "tech" }))}
                      >
                        <option value="minimal">Minimalista (Suave)</option>
                        <option value="dynamic">Dinâmico (Studio)</option>
                        <option value="tech">Tech (Moderno)</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-zinc-400 font-medium">
                      Volume SFX (dB)
                      <input className={fieldClass} value={form.sfxVolumeDb} onChange={update("sfxVolumeDb")} />
                    </label>
                  </div>
                )}
              </div>
            </div>

            <button
              disabled={!!busy || !form.sourcePath || !form.courseName || !form.moduleName}
              onClick={analyze}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-4 py-2.5 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 transition-all hover:brightness-110 disabled:opacity-40"
            >
              {busy === "analyze" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <WandSparkles size={15} />
              )}
              Analisar áudio e planejar edição
            </button>
          </aside>

          {/* PAINEL CENTRAL: Center Workspace (Player & Visual Timeline) */}
          <main className="lg:col-span-6 min-w-0 self-start flex flex-col rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden shadow-2xl relative">
            {/* Player Container */}
            <div className="p-3 flex items-center justify-center relative bg-black">
              <div className="absolute inset-0 bg-[radial-gradient(#353434_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

              <div className="w-full aspect-video bg-zinc-900 rounded-xl overflow-hidden relative shadow-2xl border border-white/10 flex flex-col justify-center items-center group">
                {videoMediaSrc ? (
                  <video
                    ref={videoRef}
                    src={videoMediaSrc}
                    preload="metadata"
                    playsInline
                    onTimeUpdate={(e) => setPlayheadTime(e.currentTarget.currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onLoadedMetadata={(event) => {
                      setPlayerDuration(event.currentTarget.duration);
                      setPlayerError(null);
                    }}
                    onEnded={() => setIsPlaying(false)}
                    onError={() => {
                      setPlayerError("Não foi possível reproduzir esta mídia no player.");
                      setIsPlaying(false);
                    }}
                    className="w-full h-full object-contain bg-black"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col justify-center items-center bg-zinc-900/90 text-center p-6">
                    <Video size={48} className="text-zinc-600 mb-3" />
                    <p className="text-xs font-bold text-zinc-300">Estúdio de Prévia Interativa</p>
                    <p className="text-[11px] text-zinc-500 max-w-md mt-1">
                      Envie o vídeo da aula ou clique em Analisar para visualizar o enquadramento do apresentador e a linha de edição.
                    </p>
                  </div>
                )}

                {/* AI Center Zoom Overlay */}
                {activeMediaAsset === "source" && selectedEvent?.kind === "zoom" && (
                  <div
                    className="absolute border border-emerald-400/70 rounded-md pointer-events-none opacity-80 shadow-[0_0_15px_rgba(78,222,163,0.25)_inset] transition-all duration-300"
                    style={{
                      top: "25%",
                      left: "35%",
                      width: "30%",
                      height: "50%",
                    }}
                  >
                    <span className="absolute -top-4 left-0 text-[9px] text-emerald-300 font-mono bg-zinc-900/90 px-1.5 py-0.5 rounded border border-emerald-500/40">
                      Zoom centralizado no vídeo
                    </span>
                  </div>
                )}

                {analysis && (
                  <div className="absolute left-3 top-3 flex items-center gap-2">
                    <span className="rounded-md border border-white/15 bg-black/75 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-200">
                      {activeMediaAsset === "preview" ? "Prévia renderizada" : "Vídeo original"}
                    </span>
                    {previewStale && activeMediaAsset === "preview" && (
                      <span className="rounded-md border border-amber-500/40 bg-amber-950/80 px-2 py-1 text-[9px] font-bold text-amber-200">
                        Alterações ainda não renderizadas
                      </span>
                    )}
                  </div>
                )}

                {playerError && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 p-6 text-center">
                    <div>
                      <Film size={32} className="mx-auto mb-2 text-red-400" />
                      <p className="text-xs font-bold text-white">{playerError}</p>
                      <p className="mt-1 text-[10px] text-zinc-400">
                        Confirme se o codec é compatível ou renderize a prévia MP4.
                      </p>
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Visual Multi-Track Timeline (Stitch Timeline) */}
            <div className={`${musicWaveform.length ? "h-[268px]" : "h-56"} bg-zinc-900/90 border-t border-white/10 flex flex-col shrink-0`}>
              {/* Timeline Header Toolbar */}
              <div className="h-9 border-b border-white/10 flex items-center px-4 justify-between bg-zinc-950 text-zinc-400">
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={addEventAtPlayhead}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-all text-[10px] font-bold"
                    title="Inserir evento no corte"
                  >
                    <Plus size={13} />
                    Adicionar Evento
                  </button>
                  <div className="w-px h-3.5 bg-white/10 mx-1" />
                  <button
                    onClick={() => setTimelineScale((s) => Math.min(3, s + 0.25))}
                    className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
                    title="Zoom In"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={() => setTimelineScale((s) => Math.max(1, s - 0.25))}
                    className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
                    title="Zoom Out"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span className="text-[10px] font-mono text-zinc-500">{(timelineScale * 100).toFixed(0)}%</span>
                  <div className="mx-1 h-3.5 w-px bg-white/10" />
                  <button
                    onClick={togglePlayPause}
                    disabled={!videoMediaSrc}
                    className="rounded p-1 transition-colors hover:bg-white/10 hover:text-emerald-400 disabled:opacity-30"
                    title={isPlaying ? "Pausar" : "Reproduzir"}
                  >
                    {isPlaying
                      ? <Pause size={14} className="fill-current text-emerald-400" />
                      : <Play size={14} className="fill-current" />}
                  </button>
                  <span className="min-w-[68px] text-[10px] font-mono text-zinc-400">
                    {clock(playheadTime)} / {clock(timelineDuration)}
                  </span>
                  <button
                    onClick={toggleMute}
                    disabled={!videoMediaSrc}
                    className="rounded p-1 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                    title={isMuted ? "Ativar áudio" : "Silenciar"}
                  >
                    {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  {videoMediaSrc && (
                    <a
                      href={`${videoMediaSrc}&download=true`}
                      title="Baixar mídia exibida"
                      className="rounded p-1 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Download size={14} />
                    </a>
                  )}
                  <button
                    onClick={toggleFullscreen}
                    disabled={!videoMediaSrc}
                    className="rounded p-1 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                    title="Tela cheia"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
                <span className="text-[10px] font-mono text-zinc-500">
                  Duração {clock(timelineDuration)}
                </span>
              </div>

              {/* Tracks Area */}
              <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <div
                  onClick={handleTimelineClick}
                  className="h-full min-w-full flex flex-col cursor-crosshair"
                  style={{ width: `${100 * timelineScale}%` }}
                >
                  <div className="grid h-6 shrink-0 grid-cols-[40px_minmax(0,1fr)] items-end border-b border-white/5 px-3">
                    <span className="pb-1 text-[8px] font-mono text-zinc-600">TC</span>
                    <div className="relative h-full select-none">
                      {rulerTicks.map((tick, index) => (
                        <span
                          key={tick}
                          className="absolute bottom-1 text-[9px] font-mono text-zinc-500"
                          style={{
                            left: `${(tick / timelineDuration) * 100}%`,
                            transform:
                              index === 0
                                ? "none"
                                : index === rulerTicks.length - 1
                                  ? "translateX(-100%)"
                                  : "translateX(-50%)",
                          }}
                        >
                          {clock(tick)}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="relative flex-1 px-3 pb-3 pt-2">
                    <div
                      ref={timelineTrackRef}
                      className="absolute bottom-3 left-[52px] right-3 top-2 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px)] [background-size:40px_100%]"
                    >
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.9)] transition-all duration-75"
                        style={{ left: `${Math.min(100, (playheadTime / timelineDuration) * 100)}%` }}
                      >
                        <div className="absolute -top-1 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-red-500 rounded-xs" />
                      </div>
                    </div>

                    <div className="relative z-10 flex h-full flex-col gap-2 pointer-events-none">

                {/* Track V1 (Video Clips) */}
                <div className="grid h-10 grid-cols-[40px_minmax(0,1fr)] items-center rounded-lg border border-white/10 bg-zinc-950/80 pointer-events-auto">
                  <span className="pl-2 text-[10px] font-mono font-bold text-zinc-500">V1</span>
                  <div className="flex-1 relative h-full flex items-center">
                    {activeMediaAsset === "preview" && (
                      <div
                        className="absolute h-7 bg-zinc-800 border border-white/20 rounded px-2 flex items-center text-[10px] text-zinc-300 font-mono truncate"
                        style={{ left: 0, width: `${(4 / timelineDuration) * 100}%` }}
                      >
                        Intro
                      </div>
                    )}
                    <div
                      className="absolute h-7 bg-emerald-950/60 border border-emerald-500 rounded px-2 flex items-center text-[10px] text-emerald-300 font-mono truncate font-bold shadow-[0_0_10px_rgba(16,185,129,0.15)_inset]"
                      style={{
                        left: `${activeMediaAsset === "preview" ? (4 / timelineDuration) * 100 : 0}%`,
                        width: `${((analysis?.media.durationSeconds || timelineDuration) / timelineDuration) * 100}%`,
                      }}
                    >
                      A-Roll ({form.moduleName || "Ativo"})
                    </div>
                    {activeMediaAsset === "preview" && (
                      <div
                        className="absolute h-7 bg-zinc-800 border border-white/20 rounded px-2 flex items-center text-[10px] text-zinc-300 font-mono truncate"
                        style={{
                          left: `${(((analysis?.media.durationSeconds || 0) + 4) / timelineDuration) * 100}%`,
                          width: `${(4 / timelineDuration) * 100}%`,
                        }}
                      >
                        Outro
                      </div>
                    )}
                  </div>
                </div>

                {/* Track FX (AI Efficacy Event Clips) */}
                <div className="grid h-9 grid-cols-[40px_minmax(0,1fr)] items-center rounded-lg border border-white/10 bg-zinc-950/60 pointer-events-auto">
                  <span className="pl-2 text-[10px] font-mono font-bold text-violet-400">FX</span>
                  <div className="flex-1 relative h-full flex items-center">
                    {analysis?.events.length ? (
                      analysis.events.map((evt) => {
                        const change = eventReview(evt);
                        const enabled = change.enabled !== false;
                        const evtStart = change.start ?? evt.start;
                        const evtDuration = change.duration ?? evt.duration;
                        const playerEventStart = eventPlayerTime(evt, evtStart);
                        const leftPct = (playerEventStart / timelineDuration) * 100;
                        const widthPct = Math.max(1.5, (evtDuration / timelineDuration) * 100);
                        const isSelected = selectedEventId === evt.id;

                        return (
                          <div
                            key={evt.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectEvent(evt.id, playerEventStart);
                            }}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            className={`absolute h-6 px-2 rounded text-[9px] font-mono font-semibold border flex items-center justify-between cursor-pointer transition-all ${
                              isSelected
                                ? "bg-emerald-500 text-black border-white shadow-lg shadow-emerald-500/40 z-10"
                                : enabled
                                  ? `${kindColorClass[evt.kind] || "bg-violet-950 border-violet-500 text-violet-300"} hover:brightness-125`
                                  : "bg-zinc-900 border-zinc-700 text-zinc-500 opacity-40"
                            }`}
                            title={`${kindLabel[evt.kind]}: ${evt.label} (${clock(playerEventStart)})`}
                          >
                            <span className="truncate">{kindLabel[evt.kind]}</span>
                            <span className="text-[8px] opacity-75 font-mono ml-1">{clock(playerEventStart)}</span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-[10px] text-zinc-500 italic pl-2">
                        Execute a análise para visualizar os eventos de corte na timeline
                      </div>
                    )}
                  </div>
                </div>

                {/* Track A1 (Audio Waveform) */}
                <div className="grid h-9 grid-cols-[40px_minmax(0,1fr)] items-center rounded-lg border border-white/10 bg-zinc-950/80 pointer-events-auto">
                  <span className="pl-2 text-[10px] font-mono font-bold text-zinc-500">A1</span>
                  <div className="flex-1 h-full flex items-center gap-px px-2 overflow-hidden">
                    {waveformBusy && !waveform.length ? (
                      <span className="flex items-center gap-1 text-[9px] text-zinc-500">
                        <Loader2 size={10} className="animate-spin" />
                        Lendo áudio
                      </span>
                    ) : waveform.length ? waveform.map((peak, index) => {
                      const pointTime = (index / waveform.length) * timelineDuration;
                      return (
                        <div
                          key={index}
                          className={`min-w-px flex-1 rounded-full ${
                            pointTime <= playheadTime ? "bg-emerald-300" : "bg-emerald-700"
                          }`}
                          style={{ height: waveformBarHeight(peak, 92) }}
                        />
                      );
                    }) : (
                      <span className="text-[9px] italic text-zinc-600">Faixa de áudio indisponível</span>
                    )}
                  </div>
                </div>
                {musicWaveform.length > 0 && (
                  <div className="grid h-8 grid-cols-[40px_minmax(0,1fr)_auto] items-center rounded-lg border border-white/10 bg-zinc-950/80 pointer-events-auto">
                    <span className="pl-2 text-[10px] font-mono font-bold text-cyan-500">A2</span>
                    <div className="flex-1 h-full flex items-center gap-px px-2 overflow-hidden">
                      {musicWaveform.map((peak, index) => (
                        <div
                          key={index}
                          className="min-w-px flex-1 rounded-full bg-cyan-700"
                          style={{ height: waveformBarHeight(peak, 82) }}
                        />
                      ))}
                    </div>
                    <span className="ml-2 text-[8px] text-cyan-400">{analysis?.media.musicDb} dB</span>
                  </div>
                )}
                </div>
              </div>
            </div>
            </div>
            </div>
          </main>

          {/* PAINEL DIREITO: Right Sidebar (Inspector & AI Insights) */}
          <aside className="lg:col-span-3 flex flex-col rounded-2xl border border-white/10 bg-zinc-900/70 p-4 backdrop-blur-xl shadow-xl space-y-4 font-body-sm">
            <div className="border-b border-white/10 pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles size={18} className="text-emerald-400" />
                Revisão da análise
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Decisões: <span className="text-cyan-300 font-medium">{analysis?.semantic.source === "agent" ? "agente semântico" : "fallback local"}</span>
                {analysis?.semantic.model ? ` · ${analysis.semantic.model}` : ""}
              </p>
            </div>

            {/* Course Identity Card */}
            {analysis?.courseTheme && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                <p className="font-bold text-white">
                  Identidade {analysis.courseTheme.reused ? "reutilizada" : "criada"}: {analysis.courseTheme.label}
                </p>
                <p className="text-[11px] text-zinc-300 mt-1 leading-snug">{analysis.courseTheme.rationale}</p>
              </div>
            )}

            {/* Event Stats Badges */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(eventCounts).map(([kind, count]) => (
                <span
                  key={kind}
                  className="rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] font-mono text-zinc-300"
                >
                  {kindLabel[kind as EditEvent["kind"]]}: <strong className="text-emerald-400">{count}</strong>
                </span>
              ))}
            </div>

            {/* Timeline Editorial & List */}
            <div className="space-y-3 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                <div>
                  <h4 className="text-xs font-bold text-white">Timeline editorial</h4>
                  <p className="text-[10px] text-zinc-400">Edição e ajustes de eventos</p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    disabled={!!busy}
                    onClick={restoreAutomatic}
                    className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40 transition-all"
                  >
                    Restaurar automático
                  </button>
                  <button
                    disabled={!!busy || !analysis?.courseName}
                    onClick={saveCourseStandard}
                    className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 transition-all"
                  >
                    Salvar padrão do curso
                  </button>
                </div>
              </div>

              {/* Event Editor Cards */}
              <div className="space-y-2">
                {analysis?.events.map((event) => {
                  const change = eventReview(event);
                  const enabled = change.enabled !== false;
                  const isSelected = selectedEventId === event.id;
                  return (
                    <div
                      id={`edit-${event.id}`}
                      key={`edit-${event.id}`}
                      onClick={() => handleSelectEvent(
                        event.id,
                        eventPlayerTime(event, change.start ?? event.start),
                      )}
                      className={`rounded-xl border p-2.5 transition-all text-xs cursor-pointer ${
                        isSelected
                          ? "border-emerald-500 bg-emerald-950/20 shadow-lg shadow-emerald-500/10"
                          : enabled
                            ? "border-white/10 bg-black/40 hover:border-white/20"
                            : "border-white/5 bg-black/20 opacity-40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(input) => updateEvent(event, { enabled: input.target.checked })}
                          className="accent-emerald-500 rounded h-3.5 w-3.5"
                        />
                        <span className="font-bold text-emerald-300 text-[11px]">{kindLabel[event.kind]}</span>
                        <span className="text-[10px] text-zinc-400 truncate">— {event.reason}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <label className="text-[10px] text-zinc-400">
                          Início (s)
                          <input
                            className={fieldClass}
                            type="number"
                            min="0"
                            step="0.1"
                            value={change.start ?? event.start}
                            onChange={(input) => updateEvent(event, { start: Number(input.target.value) })}
                          />
                        </label>
                        <label className="text-[10px] text-zinc-400">
                          Duração (s)
                          <input
                            className={fieldClass}
                            type="number"
                            min="0.1"
                            max="12"
                            step="0.1"
                            value={change.duration ?? event.duration}
                            onChange={(input) => updateEvent(event, { duration: Number(input.target.value) })}
                          />
                        </label>
                        <label className="text-[10px] text-zinc-400 col-span-2">
                          Texto
                          <input
                            className={fieldClass}
                            value={change.label ?? event.label}
                            onChange={(input) => updateEvent(event, { label: input.target.value })}
                          />
                        </label>
                      </div>

                      {event.kind === "zoom" && (
                        <div className="mt-2 grid grid-cols-3 gap-1.5 pt-1.5 border-t border-white/5">
                          <label className="text-[9px] text-zinc-400">
                            Intensidade
                            <input
                              className={fieldClass}
                              type="number"
                              min="1"
                              max="1.14"
                              step="0.01"
                              value={change.scale ?? event.scale ?? 1.12}
                              onChange={(input) => updateEvent(event, { scale: Number(input.target.value) })}
                            />
                          </label>
                          <label className="text-[9px] text-zinc-400">
                            Foco Horiz.
                            <input
                              className={fieldClass}
                              type="number"
                              min="0.28"
                              max="0.72"
                              step="0.01"
                              value={change.x ?? event.x ?? 0.5}
                              onChange={(input) => updateEvent(event, { x: Number(input.target.value) })}
                            />
                          </label>
                          <label className="text-[9px] text-zinc-400">
                            Foco Vert.
                            <input
                              className={fieldClass}
                              type="number"
                              min="0.24"
                              max="0.62"
                              step="0.01"
                              value={change.y ?? event.y ?? 0.4}
                              onChange={(input) => updateEvent(event, { y: Number(input.target.value) })}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Captions Section */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={review.captionsEnabled ?? (analysis?.design?.captionsEnabled !== false)}
                    onChange={(input) => {
                      setPreviewStale(true);
                      setReview((current) => ({ ...current, captionsEnabled: input.target.checked }));
                    }}
                    className="accent-emerald-500 rounded h-3.5 w-3.5"
                  />
                  Exibir legendas
                </label>
                {analysis?.captions.slice(0, 5).map((caption, index) => {
                  const change = captionReview(index);
                  const enabled = change.enabled !== false;
                  return (
                    <div key={`caption-${index}`} className="grid gap-1.5 rounded-lg border border-white/10 bg-black/40 p-2 text-[10px]">
                      <input
                        className={fieldClass}
                        value={change.text ?? caption.text}
                        onChange={(input) => updateCaption(index, { text: input.target.value })}
                      />
                    </div>
                  );
                })}
              </div>

              {analysis?.cursorAnalysis?.message && (
                <p className="text-[11px] text-amber-300 font-medium pt-1">
                  {analysis.cursorAnalysis.message}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Visão de Processamento em Lote (Batch View) */}
      {activeMode === "batch" && (
        <div className="space-y-5 rounded-2xl border border-violet-500/25 bg-zinc-900/70 p-6 backdrop-blur-xl shadow-2xl">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300">
                <ListVideo size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Editar curso inteiro em lote</h3>
                <p className="text-xs text-violet-300 font-medium">Pipeline Automatizado de Aulas</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              Analisa todas as aulas primeiro, identifica o tema e a progressão do módulo e só então gera cada prévia com a mesma identidade. Nenhuma aula é enviada automaticamente ao Resolve.
            </p>
          </div>

          <label className="block space-y-1 text-xs font-semibold text-zinc-300">
            Resolução de saída do lote
            <select
              className={fieldClass}
              value={form.outputResolution}
              onChange={(event) => setForm((current) => ({
                ...current,
                outputResolution: event.target.value as "full-hd" | "source",
              }))}
            >
              <option value="full-hd">Full HD (recomendado)</option>
              <option value="source">Manter resolução original</option>
            </select>
          </label>

          <label className="block space-y-1 text-xs font-semibold text-zinc-300">
            Codificação do lote
            <select
              className={fieldClass}
              value={form.videoEncoder}
              onChange={(event) => setForm((current) => ({
                ...current,
                videoEncoder: event.target.value as "auto" | "cpu",
              }))}
            >
              <option value="auto">GPU AMD automática (rápida)</option>
              <option value="cpu">CPU libx264 (compatibilidade)</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/30 p-1.5">
            <button
              type="button"
              onClick={() => setBatchSource("local")}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${batchSource === "local" ? "bg-violet-500 text-white" : "text-zinc-400 hover:bg-white/5"}`}
            >
              Pasta local
            </button>
            <button
              type="button"
              onClick={() => setBatchSource("google-drive")}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${batchSource === "google-drive" ? "bg-blue-500 text-white" : "text-zinc-400 hover:bg-white/5"}`}
            >
              Google Drive
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Pasta selecionada</p>
            <div className="flex items-center justify-between gap-3">
              <p className="truncate font-mono text-xs text-zinc-200">
                {batchFolder || (batchSource === "google-drive"
                  ? "Escolha a pasta VIDEOS_CURSO no Google Drive."
                  : "Clique no botão para escolher a pasta no Explorador do Windows.")}
              </p>
            </div>
            {batchSource === "google-drive" && !driveConnection?.batchReady && (
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] text-amber-200">
                {driveConnection?.connected
                  ? "Reconexão necessária nas Configurações para autorizar drive.readonly."
                  : "Conecte sua conta do Google Drive nas Configurações."}
              </p>
            )}
            <div className="pt-2">
              <button
                disabled={!!busy || ["queued", "running"].includes(batch?.status || "")}
                onClick={batchSource === "google-drive" ? discoverDriveBatch : discoverBatch}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-600/20 transition-all hover:brightness-110 disabled:opacity-40"
              >
                {busy === "discover-batch" || busy === "discover-drive-batch" || busy === "drive-picker" || busy === "choose-folder" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <FolderSearch size={15} />
                )}
                {batchSource === "google-drive" ? "Buscar VIDEOS_CURSO no Drive" : "Buscar pasta no computador"}
              </button>
            </div>
          </div>

          {batchSource === "google-drive" && (
            <div className="space-y-2 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-300">
                    Pasta de Download e Processamento Local (Disco)
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-200">
                    {downloadFolder || "Padrão do Sistema (AppData no Disco C:)"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={chooseDownloadFolder}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/20 disabled:opacity-40 transition-all"
                >
                  <Folder size={14} />
                  Alterar pasta / disco
                </button>
              </div>
              <p className="text-[10px] text-zinc-400">
                Escolha uma pasta em um disco com mais espaço (ex: D:\ ou E:\) se o Disco C: não possuir espaço suficiente para baixar as aulas.
              </p>
            </div>
          )}

          {/* Seleção de Vídeos - Pasta Local */}
          {batchSource === "local" && batchDiscovery && !["queued", "running"].includes(batch?.status || "") && (
            <div className="space-y-4 rounded-xl border border-violet-500/30 bg-black/40 p-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-violet-300">
                    <Film size={15} />
                    Seleção de Vídeos para Exportar
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {selectedLocalVideos.length} de {batchDiscovery.total} vídeos selecionados
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedLocalVideos(batchDiscovery.videos.map((v) => v.relativePath))}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-white/10"
                  >
                    Selecionar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLocalVideos([])}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                  >
                    Desmarcar todos
                  </button>
                </div>
              </div>

              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Filtrar vídeos por nome ou módulo..."
                  value={batchSearchQuery}
                  onChange={(e) => setBatchSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/60 pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-violet-500"
                />
              </div>

              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                {batchDiscovery.videos
                  .filter(
                    (video) =>
                      !batchSearchQuery.trim() ||
                      video.moduleName.toLowerCase().includes(batchSearchQuery.toLowerCase()) ||
                      video.relativePath.toLowerCase().includes(batchSearchQuery.toLowerCase())
                  )
                  .map((video) => {
                    const isSelected = selectedLocalVideos.includes(video.relativePath);
                    return (
                      <label
                        key={video.sourcePath}
                        className={`flex items-center gap-3 rounded-lg border p-2.5 transition-all cursor-pointer ${
                          isSelected
                            ? "border-violet-500/40 bg-violet-500/10 text-white"
                            : "border-white/5 bg-black/20 text-zinc-400 hover:border-white/15 hover:bg-white/5"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedLocalVideos((prev) => [...prev, video.relativePath]);
                            } else {
                              setSelectedLocalVideos((prev) => prev.filter((p) => p !== video.relativePath));
                            }
                          }}
                          className="h-4 w-4 rounded border-white/20 bg-black accent-violet-500"
                        />
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 font-mono text-[10px] font-bold text-violet-300">
                          {video.index}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-zinc-200">{video.moduleName}</p>
                          <p className="truncate font-mono text-[10px] text-zinc-400">{video.relativePath}</p>
                        </div>
                      </label>
                    );
                  })}
              </div>

              <button
                type="button"
                disabled={selectedLocalVideos.length === 0 || busy === "start-batch"}
                onClick={() => startBatch()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-violet-600/25 transition-all hover:brightness-110 disabled:opacity-40"
              >
                {busy === "start-batch" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Iniciar exportação por lote ({selectedLocalVideos.length} vídeos selecionados)
              </button>
            </div>
          )}

          {/* Seleção de Vídeos - Google Drive */}
          {batchSource === "google-drive" && driveBatchDiscovery && !["queued", "running"].includes(batch?.status || "") && (
            <div
              className={`space-y-4 rounded-xl border p-4 shadow-xl ${
                driveBatchDiscovery.valid ? "border-blue-500/30 bg-black/40" : "border-red-500/25 bg-red-500/[0.04]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-300">
                    <Film size={15} />
                    Seleção de Aulas do Google Drive
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[11px] text-zinc-400">
                    <span>
                      {selectedDriveLessons.length} de {driveBatchDiscovery.lessons.length} aulas selecionadas
                    </span>
                    <span>·</span>
                    <span className="font-semibold text-blue-200">
                      Tamanho total:{" "}
                      {formatBytes(
                        driveBatchDiscovery.lessons
                          .filter((l) => selectedDriveLessons.includes(l.id))
                          .reduce((sum, l) => sum + (l.file.sizeBytes || 0), 0)
                      )}
                    </span>
                    <span>·</span>
                    <span className="text-zinc-500">Disco disponível: {formatBytes(driveBatchDiscovery.availableLocalBytes)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDriveLessons(driveBatchDiscovery.lessons.map((l) => l.id))}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-white/10"
                  >
                    Selecionar todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDriveLessons([])}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                  >
                    Desmarcar todas
                  </button>
                </div>
              </div>

              {driveBatchDiscovery.issues.length > 0 && (
                <div className="space-y-1 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-[10px] text-red-200">
                  {driveBatchDiscovery.issues.map((issue, index) => (
                    <p key={`${issue.code}-${issue.moduleName}-${issue.lessonName}-${index}`}>
                      ⚠️ {issue.moduleName}/{issue.lessonName}: {issue.message}
                    </p>
                  ))}
                </div>
              )}

              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Filtrar por aula ou módulo no Drive..."
                  value={batchSearchQuery}
                  onChange={(e) => setBatchSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/60 pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-blue-500"
                />
              </div>

              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {driveBatchDiscovery.modules.map((module) => {
                  const moduleLessonIds = module.lessons.map((l) => l.id);
                  const selectedModuleLessons = moduleLessonIds.filter((id) => selectedDriveLessons.includes(id));
                  const isAllModuleSelected = selectedModuleLessons.length === moduleLessonIds.length && moduleLessonIds.length > 0;
                  const isSomeModuleSelected = selectedModuleLessons.length > 0 && !isAllModuleSelected;

                  const filteredLessons = module.lessons.filter(
                    (l) =>
                      !batchSearchQuery.trim() ||
                      module.name.toLowerCase().includes(batchSearchQuery.toLowerCase()) ||
                      l.lessonName.toLowerCase().includes(batchSearchQuery.toLowerCase()) ||
                      l.file.name.toLowerCase().includes(batchSearchQuery.toLowerCase())
                  );

                  if (filteredLessons.length === 0 && batchSearchQuery.trim()) return null;

                  return (
                    <div key={module.id} className="rounded-xl border border-white/10 bg-black/50 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isAllModuleSelected}
                            ref={(input) => {
                              if (input) input.indeterminate = isSomeModuleSelected;
                            }}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDriveLessons((prev) => Array.from(new Set([...prev, ...moduleLessonIds])));
                              } else {
                                setSelectedDriveLessons((prev) => prev.filter((id) => !moduleLessonIds.includes(id)));
                              }
                            }}
                            className="h-4 w-4 rounded border-white/20 bg-black accent-blue-500"
                          />
                          <span className="text-xs font-bold text-blue-200">
                            {module.index}. {module.name}
                          </span>
                        </label>
                        <span className="text-[10px] font-medium text-zinc-400">
                          {selectedModuleLessons.length}/{module.lessons.length} aulas selecionadas
                        </span>
                      </div>

                      <div className="space-y-1.5 pl-2">
                        {filteredLessons.map((lesson) => {
                          const isSelected = selectedDriveLessons.includes(lesson.id);
                          return (
                            <label
                              key={lesson.id}
                              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition-all cursor-pointer ${
                                isSelected
                                  ? "border-blue-500/40 bg-blue-500/10 text-zinc-100"
                                  : "border-white/5 bg-black/30 text-zinc-400 hover:border-white/15 hover:bg-white/5"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedDriveLessons((prev) => [...prev, lesson.id]);
                                    } else {
                                      setSelectedDriveLessons((prev) => prev.filter((id) => id !== lesson.id));
                                    }
                                  }}
                                  className="h-3.5 w-3.5 rounded border-white/20 bg-black accent-blue-500"
                                />
                                <div className="min-w-0">
                                  <p className="font-semibold text-zinc-200 truncate">
                                    {lesson.lessonIndex}. {lesson.lessonName}
                                  </p>
                                  <p className="font-mono text-[10px] text-zinc-400 truncate">{lesson.file.name}</p>
                                </div>
                              </div>
                              <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                                {formatBytes(lesson.file.sizeBytes || 0)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={selectedDriveLessons.length === 0 || !driveBatchDiscovery.valid || busy === "start-batch"}
                onClick={() => startDriveBatch(driveBatchDiscovery)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-blue-600/25 transition-all hover:brightness-110 disabled:opacity-40"
              >
                {busy === "start-batch" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Iniciar exportação por lote do Drive ({selectedDriveLessons.length} aulas selecionadas)
              </button>
            </div>
          )}

          {batch && (
            <div className="space-y-4 rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-zinc-100">
                    {batch.courseIdentity?.title || batch.courseName} · {batch.completed}/{batch.total} concluídas
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Estado: <span className="font-semibold text-violet-300">{batch.status}</span>
                    {batch.failed > 0 ? ` · ${batch.failed} com falha` : ""}
                  </p>
                  {batch.error && <p className="mt-1 text-[10px] text-red-300">{batch.error}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {["queued", "running"].includes(batch.status) && (
                    <button disabled={!!busy} onClick={() => changeBatchState("cancel-batch")} className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-semibold text-red-200 disabled:opacity-40">Cancelar lote</button>
                  )}
                  {batch.status === "cancelled" && (
                    <button disabled={!!busy} onClick={() => changeBatchState("resume-batch")} className="rounded-xl border border-blue-400/30 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-200 disabled:opacity-40">Retomar lote</button>
                  )}
                  {batch.failed > 0 && !["queued", "running"].includes(batch.status) && (
                    <button
                      disabled={!!busy}
                      onClick={retryBatch}
                      className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/20 disabled:opacity-40"
                    >
                      <RotateCcw size={13} />
                      Repetir falhas
                    </button>
                  )}
                </div>
              </div>
              {batch.outputFolderUrl && (
                <a href={batch.outputFolderUrl} target="_blank" rel="noreferrer" className="block text-[11px] font-bold text-blue-300 hover:underline">
                  Abrir pasta de resultados no Google Drive
                </a>
              )}
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-emerald-400 transition-all duration-500"
                  style={{
                    width: `${batch.total ? Math.round(((batch.completed + batch.failed) / batch.total) * 100) : 0}%`,
                  }}
                />
              </div>
              {batch.items && (
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {batch.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-white/10 bg-zinc-900/60 p-3 text-[11px] flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-zinc-200">{item.index}. {item.moduleName}{item.lessonName ? ` / ${item.lessonName}` : ""}</p>
                        {item.error && <p className="truncate text-[10px] text-red-300">{item.error}</p>}
                        {item.remoteOutputUrl && <a href={item.remoteOutputUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-300 hover:underline">Abrir vídeo no Drive</a>}
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <span className="text-emerald-300 font-bold uppercase text-[10px]">{item.status}</span>
                        {item.totalBytes && ["downloading", "uploading"].includes(item.status) && (
                          <p className="text-[9px] text-zinc-500">{Math.round(((item.bytesTransferred || 0) / item.totalBytes) * 100)}%</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Console de Logs em Tempo Real */}
      <div className="my-6 pb-16">
        <VideoEditorConsole
          logs={consoleLogs}
          onClearLogs={() => setConsoleLogs([])}
          isProcessing={Boolean(busy)}
        />
      </div>

      {status?.pendingPlan && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 backdrop-blur-xl shadow-xl flex items-center justify-between">
          <p className="text-xs font-medium text-amber-200">
            Há um plano anterior aguardando aplicação no Resolve.
          </p>
          <button
            disabled={!!busy}
            onClick={archivePending}
            className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/20 px-3.5 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/30 disabled:opacity-40 transition-all"
          >
            <Archive size={14} />
            Arquivar plano anterior
          </button>
        </div>
      )}

      {/* Sticky Bottom Workstation Footer (Stitch Footer) */}
      <footer className="fixed bottom-0 left-0 right-0 h-[64px] bg-zinc-950/95 border-t border-white/10 px-6 backdrop-blur-xl z-50 flex items-center justify-between shadow-2xl">
        <div className="flex flex-col">
          <span className="text-[11px] font-bold text-zinc-300">Kaoz.1 v0.2.32</span>
          {analysis?.artifacts.previewPath ? (
            <span className="text-[10px] font-mono text-emerald-400 truncate max-w-md">
              Prévia: {analysis.artifacts.previewPath}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500">Pronto para processamento e aprovação</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            disabled={!!busy || !analysis}
            onClick={renderPreview}
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-40 transition-all"
          >
            {busy === "render-preview" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Film size={14} />
            )}
            {analysis?.artifacts.previewPath ? "Renderizar novamente" : "Renderizar vídeo"}
          </button>

          <button
            disabled={!!busy || !analysis?.artifacts.previewPath || previewStale || !!status?.pendingPlan}
            onClick={approve}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-5 py-2 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 hover:brightness-110 disabled:opacity-40 transition-all"
          >
            <CheckCircle size={15} />
            Preparar para o DaVinci (opcional)
          </button>
        </div>
      </footer>
    </div>
  );
}
