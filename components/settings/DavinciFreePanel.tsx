"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
  Palette,
  Subtitles,
  Video,
  Search,
  Trash2,
  Split,
  Eye,
  EyeOff,
  Layers,
  Type,
  Sliders,
  Clock,
  FastForward,
  Rewind,
  Check,
  X,
  ChevronRight,
  Zap,
} from "lucide-react";
import { GoogleDriveVideoControls, pickGoogleDriveFolder } from "@/components/video/GoogleDriveVideoControls";
import {
  VideoEditorConsole,
  type ConsoleLogEntry,
  type ConsoleLogLevel,
} from "@/components/video/video-editor-console";
import { BUILD_VERSION } from "@/lib/app-version";
import {
  detectSilenceRanges,
  editedVideoDuration,
  editedVideoTime,
  findActiveClipAtTime,
  nextPlayheadAfterCuts,
  videoActiveClips,
  videoCutRanges,
  type VideoActiveClip,
  type VideoCutRange,
} from "@/services/davinci-free/video-cuts";
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
  analysisStatus?: {
    status: "running" | "completed" | "failed";
    requestId: string;
    sourcePath: string;
    startedAt: string;
    progress?: number;
    stage?: string;
    completedAt?: string;
    planId?: string;
    error?: string;
  } | null;
  renderStatus?: {
    status: "running" | "completed" | "failed";
    planId: string;
    progress: number;
    stage: string;
    startedAt: string;
    completedAt?: string;
    error?: string;
  } | null;
};

type ProgressStatus = Pick<Status, "analysisStatus" | "renderStatus">;

type VideoSpeechModel = {
  id: string;
  name: string;
  engine: "whisper-cpp" | "parakeet";
  sizeBytes: number;
  state: "not-installed" | "partial" | "queued" | "downloading" | "verifying" | "ready" | "error";
  downloadedBytes: number;
  error?: string;
};

const EMPTY_STATUS: Status = {
  runnerInstalled: false,
  runnerDirectory: "",
  pendingPlan: null,
  latestResult: null,
  instructions: [],
};

function mergeProgressStatus(current: Status | null, progress: ProgressStatus): Status {
  return { ...(current ?? EMPTY_STATUS), ...progress };
}

type EditEvent = {
  id: string;
  kind:
    | "intro"
    | "outro"
    | "lower-third"
    | "impact-text"
    | "zoom"
    | "cut"
    | "remove"
    | "cursor"
    | "transition"
    | "sound-effect"
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
  lessonNumber?: string;
  lessonName?: string;
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
  transcription?: { engine: string; modelId?: string; backend?: string; deviceName?: string; language: string };
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
  artifacts: { previewPath?: string; transcriptTextPath?: string; captionsPath: string; planPath: string };
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
  "w-full rounded-[6px] border border-white/10 bg-[#0D0F14] px-2.5 py-1.5 text-xs text-[#F4F5F7] placeholder-[#5D6472] outline-none transition-colors hover:border-white/15 focus:border-[#7C6CF2]/70 focus:ring-1 focus:ring-[#7C6CF2]/20";

const kindLabel: Record<EditEvent["kind"], string> = {
  intro: "Intro",
  outro: "Encerramento",
  "lower-third": "Lower third",
  "impact-text": "Texto de impacto",
  zoom: "Zoom",
  cut: "Corte de plano",
  remove: "Trecho removido",
  cursor: "Cursor",
  transition: "Transição",
  "sound-effect": "SFX inteligente",
  "meme-sfx": "Efeito Meme 🤡",
};

const kindColorClass: Record<EditEvent["kind"], string> = {
  intro: "bg-emerald-950/90 border-emerald-500 text-emerald-300",
  outro: "bg-[#171A21]/90 border-[#383D49] text-[#D5D8E0]",
  "lower-third": "bg-[#101217]/90 border-[#8B92A1] text-[#F4F5F7]",
  "impact-text": "bg-cyan-950/90 border-cyan-500 text-cyan-300",
  zoom: "bg-amber-950/90 border-amber-500 text-amber-300",
  cut: "bg-zinc-800 border-zinc-500 text-zinc-300",
  remove: "bg-red-950/90 border-red-500 text-red-200",
  cursor: "bg-blue-950/90 border-blue-500 text-blue-300",
  transition: "bg-pink-950/90 border-pink-500 text-pink-300",
  "sound-effect": "bg-violet-950/90 border-violet-500 text-violet-300",
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
  const [applicationVersion, setApplicationVersion] = useState(BUILD_VERSION);
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
  const [pendingSourceCuts, setPendingSourceCuts] = useState<EditEvent[]>([]);
  const [cutStartTime, setCutStartTime] = useState<number | null>(null);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [liveCutPreview, setLiveCutPreview] = useState<boolean>(true);
  const [showSilenceModal, setShowSilenceModal] = useState<boolean>(false);
  const [silenceThreshold, setSilenceThreshold] = useState<number>(0.045);
  const [silenceMinDuration, setSilenceMinDuration] = useState<number>(0.4);
  const [silencePadding, setSilencePadding] = useState<number>(0.08);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
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
  const [speechModels, setSpeechModels] = useState<VideoSpeechModel[]>([]);
  const [speechModelBusy, setSpeechModelBusy] = useState<string | null>(null);

  const addLog = useCallback((level: ConsoleLogLevel, message: string, details?: string) => {
    const timestamp = new Date().toLocaleTimeString("pt-BR");
    setConsoleLogs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), timestamp, level, message, details },
    ]);
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState({
    sourcePath: "",
    courseName: "",
    moduleName: "Módulo 1",
    lessonNumber: "1",
    lessonName: "Boas-vindas",
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
    transcriptionModelId: "",
    transcriptionDevice: "auto" as "auto" | "vulkan" | "cpu",
    transcriptionAllowCloudFallback: false,
  });

  const refreshSpeechModels = useCallback(async () => {
    const response = await fetch("/api/speech/models", { cache: "no-store" });
    const data = await response.json() as { models?: VideoSpeechModel[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Falha ao consultar os modelos de transcricao.");
    setSpeechModels(data.models || []);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      refreshSpeechModels(),
      fetch("/api/speech/config", { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as { modelId?: unknown; device?: unknown; allowCloudFallback?: unknown };
        if (!active || !response.ok) return;
        setForm((current) => ({
          ...current,
          transcriptionModelId: typeof data.modelId === "string" ? data.modelId : "",
          transcriptionDevice: data.device === "vulkan" || data.device === "cpu" ? data.device : "auto",
          transcriptionAllowCloudFallback: data.allowCloudFallback === true,
        }));
      }),
    ]).catch((error) => addLog("warn", "Nao foi possivel carregar os modelos de transcricao.", caughtMessage(error)));
    return () => { active = false; };
  }, [addLog, refreshSpeechModels]);

  useEffect(() => {
    if (!speechModels.some((model) => ["queued", "downloading", "verifying"].includes(model.state))) return;
    const timer = window.setInterval(() => void refreshSpeechModels(), 1500);
    return () => window.clearInterval(timer);
  }, [refreshSpeechModels, speechModels]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/davinci-free", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao consultar o Resolve Free.");
    setStatus(data);
  }, []);

  const refreshProgress = useCallback(async () => {
    const response = await fetch("/api/davinci-free?progress=1", { cache: "no-store" });
    const data = await response.json() as ProgressStatus & { error?: string };
    if (!response.ok) throw new Error(data.error || "Falha ao consultar o progresso do processamento.");
    setStatus((current) => mergeProgressStatus(current, data));
  }, []);

  useEffect(() => {
    const bridge = window.kaoz1Desktop;
    if (!bridge) return;

    let mounted = true;
    void bridge.getUpdateStatus()
      .then((updateStatus) => {
        if (mounted && updateStatus.currentVersion) setApplicationVersion(updateStatus.currentVersion);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    refreshProgress().catch(() => undefined);
    refresh().catch((error) =>
      onStatusMessage({ text: String(error), type: "error" }),
    );
  }, [onStatusMessage, refresh, refreshProgress]);

  useEffect(() => {
    if (busy !== "analyze" && status?.analysisStatus?.status !== "running") return;
    if (status?.analysisStatus?.status === "running") setBusy("analyze");
    const timer = window.setInterval(() => {
      refreshProgress().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [busy, refreshProgress, status?.analysisStatus?.status]);

  useEffect(() => {
    if (status?.analysisStatus?.status !== "completed" || analysis) return;
    fetch("/api/davinci-free?analysis=1", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.analysis) return;
        setAnalysis(data.analysis as Analysis);
        setReview((data.editorialReview as EditorialReview | null) || { events: [], captions: [] });
        setPreviewStale(false);
      })
      .catch(() => undefined);
  }, [analysis, status?.analysisStatus?.status]);

  useEffect(() => {
    if (status?.analysisStatus?.status !== "running") {
      setBusy((current) => current === "analyze" ? null : current);
    }
  }, [status?.analysisStatus?.status]);

  useEffect(() => {
    if (busy !== "render-preview" && status?.renderStatus?.status !== "running") return;
    if (status?.renderStatus?.status === "running") setBusy("render-preview");
    const timer = window.setInterval(() => {
      refreshProgress().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [busy, refreshProgress, status?.renderStatus?.status]);

  useEffect(() => {
    if (status?.renderStatus?.status !== "running") {
      setBusy((current) => current === "render-preview" ? null : current);
    }
  }, [status?.renderStatus?.status]);

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

  async function manageSpeechModel(modelId: string, modelAction: "download" | "cancel") {
    setSpeechModelBusy(modelId);
    try {
      const response = await fetch("/api/speech/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: modelAction, modelId }),
      });
      const data = await response.json() as { model?: VideoSpeechModel; error?: string };
      if (!response.ok || !data.model) throw new Error(data.error || "Falha ao gerenciar o modelo.");
      setSpeechModels((current) => current.map((model) => model.id === modelId ? data.model! : model));
      addLog("info", modelAction === "download" ? "Download do modelo de transcricao iniciado." : "Download cancelado.", data.model.name);
    } catch (error) {
      onStatusMessage({ text: caughtMessage(error), type: "error" });
    } finally {
      setSpeechModelBusy(null);
    }
  }

  async function analyze() {
    const selectedSpeechModel = speechModels.find((model) => model.id === form.transcriptionModelId);
    if (!selectedSpeechModel || selectedSpeechModel.state !== "ready") {
      const text = selectedSpeechModel
        ? `O modelo ${selectedSpeechModel.name} ainda nao foi baixado.`
        : "Selecione um modelo de transcricao antes de analisar o video.";
      addLog("warn", text);
      onStatusMessage({ text, type: "error" });
      return;
    }
    addLog("info", "Iniciando análise inteligente do áudio e vídeo...", form.sourcePath ? `Caminho: ${form.sourcePath}` : "Google Drive");
    const result = await action("analyze", {
      requestId: `analysis-${crypto.randomUUID()}`,
      sourcePath: form.sourcePath,
      sourceOrigin: driveSourceOrigin ? { ...driveSourceOrigin, provider: "google-drive" } : undefined,
      courseName: form.courseName,
      moduleName: form.moduleName,
      lessonNumber: form.lessonNumber,
      lessonName: form.lessonName,
      style: form.style,
      captionsEnabled: form.captionsEnabled,
      reuseCourseTheme: form.reuseCourseTheme,
      musicPath: form.musicPath,
      musicDb: Number(form.musicDb),
      sfxEnabled: form.sfxEnabled,
      sfxVolumeDb: Number(form.sfxVolumeDb),
      sfxPack: form.sfxPack,
      useAgent: true,
      transcriptionRuntime: window.kaoz1Desktop ? "desktop" : "web",
      transcriptionModelId: form.transcriptionModelId,
      transcriptionDevice: form.transcriptionDevice,
      transcriptionAllowCloudFallback: form.transcriptionAllowCloudFallback,
    });
    if (result?.id) {
      const prepared = await prepareAnalyzedVideo(result as Analysis);
      setAnalysis(prepared.analysis);
      setReview(prepared.review);
      setPendingSourceCuts([]);
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

  async function prepareAnalyzedVideo(result: Analysis) {
    const draftReview: EditorialReview = {
      events: [],
      captions: [],
      ...(pendingSourceCuts.length ? { addedEvents: pendingSourceCuts } : {}),
    };
    if (!pendingSourceCuts.length) return { analysis: result, review: draftReview };
    const saved = await action("save-editorial-review", { planId: result.id, review: draftReview });
    return { analysis: (saved || result) as Analysis, review: draftReview };
  }

  function applySingleVideoPath(sourcePath: string) {
    setDriveSourceOrigin(null);
    const inferredLessonName = sourcePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "";
    setForm((current) => ({
      ...current,
      sourcePath,
      lessonName: current.lessonName || inferredLessonName,
    }));
    setAnalysis(null);
    setReview({ events: [], captions: [] });
    setPendingSourceCuts([]);
    setCutStartTime(null);
    setPlayerDuration(0);
    setPlayheadTime(0);
    setPreviewStale(false);
    addLog("info", "Vídeo selecionado:", sourcePath);
    onStatusMessage({ text: `Vídeo selecionado: ${sourcePath}`, type: "info" });
  }

  async function chooseSingleVideo() {
    if (!window.kaoz1Desktop?.chooseVideoFile) {
      videoFileInputRef.current?.click();
      return;
    }
    const selectedPath = await window.kaoz1Desktop.chooseVideoFile();
    if (selectedPath) applySingleVideoPath(selectedPath);
  }

  async function uploadWebVideo(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy("upload-video");
    onStatusMessage({ text: `Enviando ${file.name} para o editor local...`, type: "info" });
    try {
      const response = await fetch("/api/davinci-free/upload-video", {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-kaoz-video-name": encodeURIComponent(file.name),
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao enviar o vídeo.");
      applySingleVideoPath(String(result.sourcePath));
    } catch (error) {
      onStatusMessage({ text: caughtMessage(error), type: "error" });
    } finally {
      input.value = "";
      setBusy(null);
    }
  }

  async function renderPreview() {
    if (!analysis) return;
    setBusy("render-preview");
    try {
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
        transcriptionRuntime: window.kaoz1Desktop ? "desktop" : "web",
        transcriptionModelId: form.transcriptionModelId,
        transcriptionDevice: form.transcriptionDevice,
        transcriptionAllowCloudFallback: form.transcriptionAllowCloudFallback,
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
    } finally {
      setBusy(null);
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

  function hasReadySpeechModel(): boolean {
    const selected = speechModels.find((model) => model.id === form.transcriptionModelId);
    if (selected?.state === "ready") return true;
    onStatusMessage({ text: selected ? `Baixe ${selected.name} antes de iniciar.` : "Selecione um modelo de transcricao antes de iniciar.", type: "error" });
    return false;
  }

  async function startDriveBatch(discovery = driveBatchDiscovery, selectedIds = selectedDriveLessons) {
    if (!hasReadySpeechModel()) return;
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
        sfxEnabled: form.sfxEnabled,
        sfxVolumeDb: Number(form.sfxVolumeDb),
        sfxPack: form.sfxPack,
        useAgent: true,
        selectedItemIds: selectedIds,
        downloadFolder: downloadFolder || undefined,
        outputResolution: form.outputResolution,
        videoEncoder: form.videoEncoder,
        transcriptionRuntime: window.kaoz1Desktop ? "desktop" : "web",
        transcriptionModelId: form.transcriptionModelId,
        transcriptionDevice: form.transcriptionDevice,
        transcriptionAllowCloudFallback: form.transcriptionAllowCloudFallback,
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
    if (!hasReadySpeechModel()) return;
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
        sfxEnabled: form.sfxEnabled,
        sfxVolumeDb: Number(form.sfxVolumeDb),
        sfxPack: form.sfxPack,
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
      return activeMediaAsset === "preview"
        ? editedVideoDuration(analysis.events, analysis.media.durationSeconds) + 8
        : analysis.media.durationSeconds;
    }
    return 1;
  }, [activeMediaAsset, analysis, playerDuration]);

  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const visibleDuration = timelineDuration / timelineScale;
    const step = visibleDuration > 300 ? 60 : visibleDuration > 120 ? 30 : visibleDuration > 60 ? 15 : 5;
    for (let i = 0; i <= timelineDuration; i += step) {
      ticks.push(i);
    }
    const lastWholeSecond = Math.floor(timelineDuration);
    if (ticks.length > 0) {
      const lastTick = ticks[ticks.length - 1];
      if (lastWholeSecond - lastTick >= step * 0.6) {
        ticks.push(lastWholeSecond);
      }
    } else {
      ticks.push(0);
    }
    return ticks;
  }, [timelineDuration, timelineScale]);

  const videoMediaSrc = useMemo(() => {
    if (analysis) return `/api/davinci-free/media?planId=${analysis.id}&asset=${activeMediaAsset}`;
    if (!form.sourcePath) return "";
    return `/api/davinci-free/media?sourcePath=${encodeURIComponent(form.sourcePath)}&asset=source`;
  }, [activeMediaAsset, analysis, form.sourcePath]);
  const sourceCutEvents = useMemo(
    () => analysis?.events.filter((event) => event.kind === "remove") || pendingSourceCuts,
    [analysis, pendingSourceCuts],
  );

  const activeClips = useMemo(() => {
    if (activeMediaAsset === "preview") return [];
    const events = analysis?.events || pendingSourceCuts;
    const rawDuration = analysis?.media.durationSeconds || playerDuration || 0.1;
    return videoActiveClips(events, rawDuration);
  }, [activeMediaAsset, analysis?.events, analysis?.media.durationSeconds, pendingSourceCuts, playerDuration]);

  const activeCutRanges = useMemo(() => {
    const events = analysis?.events || pendingSourceCuts;
    const rawDuration = analysis?.media.durationSeconds || playerDuration || 0.1;
    return videoCutRanges(events, rawDuration);
  }, [analysis?.events, analysis?.media.durationSeconds, pendingSourceCuts, playerDuration]);

  const detectedSilences = useMemo(() => {
    if (!waveform.length || timelineDuration <= 0) return [];
    return detectSilenceRanges(waveform, timelineDuration, {
      minSilenceDuration: silenceMinDuration,
      threshold: silenceThreshold,
      padding: silencePadding,
    });
  }, [waveform, timelineDuration, silenceMinDuration, silenceThreshold, silencePadding]);

  const totalSilenceSeconds = useMemo(() => {
    return detectedSilences.reduce((acc, s) => acc + (s.end - s.start), 0);
  }, [detectedSilences]);

  const timelineEvents = useMemo(() => {
    if (activeMediaAsset === "preview") {
      return (analysis?.events || []).filter((evt) => evt.kind !== "remove");
    }
    return analysis?.events || pendingSourceCuts;
  }, [activeMediaAsset, analysis?.events, pendingSourceCuts]);

  const processingProgress = busy === "render-preview"
    ? status?.renderStatus?.status === "running" && status.renderStatus.planId === analysis?.id
      ? { ...status.renderStatus, label: "Renderizando" }
      : { progress: 1, stage: "Iniciando renderização...", label: "Renderizando" }
    : busy === "analyze"
      ? status?.analysisStatus?.status === "running"
        ? {
            progress: status.analysisStatus.progress ?? 1,
            stage: status.analysisStatus.stage ?? "Analisando e planejando edição...",
            label: "Analisando",
          }
        : { progress: 1, stage: "Iniciando análise e planejamento...", label: "Analisando" }
      : null;
  const waveformPointCount = Math.min(720, Math.round(360 * timelineScale));

  useEffect(() => {
    setPlayerDuration(0);
    setPlayerError(null);
    setPlayheadTime(0);
    setInPoint(null);
    setOutPoint(null);
    setSelectedClipId(null);
  }, [videoMediaSrc]);

  useEffect(() => {
    if (!analysis && !form.sourcePath) {
      setWaveform([]);
      setMusicWaveform([]);
      return;
    }
    const controller = new AbortController();
    setWaveformBusy(true);
    const load = async (asset: "source" | "preview" | "music") => {
      const query = analysis
        ? `planId=${analysis.id}&asset=${asset}`
        : `sourcePath=${encodeURIComponent(form.sourcePath)}&asset=source`;
      const response = await fetch(
        `/api/davinci-free/media?${query}&waveform=true&points=${waveformPointCount}`,
        { cache: "no-store", signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao ler a faixa de áudio.");
      return Array.isArray(data.peaks) ? data.peaks as number[] : [];
    };
    Promise.all([
      load(activeMediaAsset).then(setWaveform),
      analysis?.media.musicPath
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
  }, [activeMediaAsset, analysis, form.sourcePath, onStatusMessage, waveformPointCount]);

  function eventPlayerTime(event: EditEvent, sourceTime: number) {
    if (activeMediaAsset !== "preview") return sourceTime;
    if (event.kind === "intro") return 0;
    const rawDuration = analysis?.media.durationSeconds || sourceTime;
    const duration = analysis ? editedVideoDuration(analysis.events, rawDuration) : rawDuration;
    if (event.kind === "outro") return duration + 4;
    return (analysis ? editedVideoTime(analysis.events, rawDuration, sourceTime) : sourceTime) + 4;
  }

  const isScrubbingRef = useRef(false);

  const seekToClientX = useCallback((clientX: number) => {
    if (!timelineTrackRef.current) return;
    const rect = timelineTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = clickX / rect.width;
    const newTime = Math.max(0, Math.min(timelineDuration, ratio * timelineDuration));
    const roundedTime = Math.round(newTime * 100) / 100;
    setPlayheadTime(roundedTime);
    if (videoRef.current) {
      videoRef.current.currentTime = roundedTime;
    }
  }, [timelineDuration]);

  function handleTimelineMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    isScrubbingRef.current = true;
    seekToClientX(event.clientX);

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (isScrubbingRef.current) {
        seekToClientX(moveEvent.clientX);
      }
    };
    const onMouseUp = () => {
      isScrubbingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function handleTimelineClick(event: React.MouseEvent<HTMLDivElement>) {
    seekToClientX(event.clientX);
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

  useEffect(() => {
    if (!isPlaying) return;
    let frameId: number;
    const tick = () => {
      if (videoRef.current && !isScrubbingRef.current) {
        const curTime = videoRef.current.currentTime;
        if (liveCutPreview && activeMediaAsset === "source" && activeCutRanges.length) {
          const skip = nextPlayheadAfterCuts(curTime, activeCutRanges);
          if (skip.jumped) {
            videoRef.current.currentTime = skip.newTime;
            setPlayheadTime(skip.newTime);
            frameId = requestAnimationFrame(tick);
            return;
          }
        }
        setPlayheadTime(curTime);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [activeCutRanges, activeMediaAsset, isPlaying, liveCutPreview]);

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

  const addRemovalCut = useCallback((start: number, end: number, label = "Corte manual") => {
    const safeStart = Math.max(0, Math.min(start, end));
    const safeEnd = Math.min(timelineDuration, Math.max(start, end));
    if (safeEnd - safeStart < 0.1) {
      onStatusMessage({ text: "O trecho do corte precisa ter pelo menos 0,1 segundo.", type: "error" });
      return;
    }
    const cut: EditEvent = {
      id: `custom-evt-${crypto.randomUUID().slice(0, 8)}`,
      kind: "remove",
      start: Math.round(safeStart * 10) / 10,
      duration: Math.round((safeEnd - safeStart) * 10) / 10,
      label,
      reason: "Trecho marcado manualmente para remoção.",
    };
    if (analysis) {
      setAnalysis((current) => current ? { ...current, events: [...current.events, cut] } : null);
      setReview((current) => ({ ...current, addedEvents: [...(current.addedEvents || []), cut] }));
      setPreviewStale(true);
    } else {
      setPendingSourceCuts((current) => [...current, cut]);
    }
    setCutStartTime(null);
    onStatusMessage({ text: `Corte marcado de ${clock(cut.start)} até ${clock(cut.start + cut.duration)}.`, type: "success" });
  }, [analysis, onStatusMessage, timelineDuration]);

  function toggleCutAtPlayhead() {
    if (cutStartTime === null) {
      setCutStartTime(playheadTime);
      onStatusMessage({ text: `Início do corte marcado em ${clock(playheadTime)}.`, type: "info" });
      return;
    }
    addRemovalCut(cutStartTime, playheadTime, "Silêncio ou trecho removido");
  }

  const undoLastRemovalCut = useCallback(() => {
    if (analysis) {
      const last = [...sourceCutEvents].at(-1);
      if (!last) return;
      updateEvent(last, { enabled: false });
      return;
    }
    setPendingSourceCuts((current) => current.slice(0, -1));
  }, [analysis, sourceCutEvents]);

  const markIn = useCallback(() => {
    const rounded = Math.round(playheadTime * 100) / 100;
    setInPoint(rounded);
    if (outPoint !== null && outPoint <= rounded) {
      setOutPoint(null);
    }
    onStatusMessage({ text: `Ponto de Entrada [In] marcado em ${clock(rounded)}.`, type: "info" });
  }, [onStatusMessage, outPoint, playheadTime]);

  const markOut = useCallback(() => {
    const rounded = Math.round(playheadTime * 100) / 100;
    setOutPoint(rounded);
    if (inPoint !== null && inPoint >= rounded) {
      setInPoint(null);
    }
    onStatusMessage({ text: `Ponto de Saída [Out] marcado em ${clock(rounded)}.`, type: "info" });
  }, [inPoint, onStatusMessage, playheadTime]);

  const clearInOut = useCallback(() => {
    setInPoint(null);
    setOutPoint(null);
  }, []);

  const deleteInOutRange = useCallback(() => {
    if (inPoint === null || outPoint === null) {
      onStatusMessage({ text: "Marque os pontos de Entrada [In] e Saída [Out] antes de excluir.", type: "error" });
      return;
    }
    const start = Math.min(inPoint, outPoint);
    const end = Math.max(inPoint, outPoint);
    addRemovalCut(start, end, `Corte [${clock(start)} - ${clock(end)}]`);
    setInPoint(null);
    setOutPoint(null);
  }, [addRemovalCut, inPoint, onStatusMessage, outPoint]);

  const splitAtPlayhead = useCallback(() => {
    if (!activeClips.length) return;
    const clip = findActiveClipAtTime(activeClips, playheadTime);
    if (!clip) {
      onStatusMessage({ text: "Posicione a agulha dentro de um clipe para fatiar.", type: "error" });
      return;
    }
    if (playheadTime <= clip.start + 0.05 || playheadTime >= clip.end - 0.05) {
      onStatusMessage({ text: "Agulha muito próxima da borda do clipe.", type: "error" });
      return;
    }
    setCutStartTime(playheadTime);
    onStatusMessage({
      text: `Fatiado em ${clock(playheadTime)}. Use Q para cortar início, W para cortar fim ou selecione outro ponto.`,
      type: "success",
    });
  }, [activeClips, onStatusMessage, playheadTime]);

  const trimClipInAtPlayhead = useCallback(() => {
    if (!activeClips.length) return;
    const clip = findActiveClipAtTime(activeClips, playheadTime);
    if (!clip || playheadTime <= clip.start + 0.05) return;
    addRemovalCut(clip.start, playheadTime, `Início até ${clock(playheadTime)}`);
  }, [activeClips, addRemovalCut, playheadTime]);

  const trimClipOutAtPlayhead = useCallback(() => {
    if (!activeClips.length) return;
    const clip = findActiveClipAtTime(activeClips, playheadTime);
    if (!clip || playheadTime >= clip.end - 0.05) return;
    addRemovalCut(playheadTime, clip.end, `${clock(playheadTime)} até fim`);
  }, [activeClips, addRemovalCut, playheadTime]);

  const deleteSelectedClip = useCallback(() => {
    if (!selectedClipId) return;
    const clip = activeClips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    addRemovalCut(clip.start, clip.end, `Clipe ${clip.index + 1} removido`);
    setSelectedClipId(null);
  }, [activeClips, addRemovalCut, selectedClipId]);

  const removeSpecificCut = useCallback((cutId: string) => {
    if (analysis) {
      setAnalysis((current) => current ? {
        ...current,
        events: current.events.filter((e) => e.id !== cutId),
      } : null);
      setReview((current) => ({
        ...current,
        events: current.events.map((e) => e.id === cutId ? { ...e, enabled: false } : e),
        addedEvents: (current.addedEvents || []).filter((e) => e.id !== cutId),
      }));
      setPreviewStale(true);
    } else {
      setPendingSourceCuts((current) => current.filter((c) => c.id !== cutId));
    }
    onStatusMessage({ text: "Trecho cortado restaurado na timeline.", type: "success" });
  }, [analysis, onStatusMessage]);

  const applyAutoCutSilences = useCallback((ranges: VideoCutRange[]) => {
    if (!ranges.length) {
      onStatusMessage({ text: "Nenhum silêncio para cortar.", type: "error" });
      return;
    }
    const newCuts: EditEvent[] = ranges.map((r, i) => ({
      id: `silence-cut-${crypto.randomUUID().slice(0, 8)}`,
      kind: "remove" as const,
      start: r.start,
      duration: Math.round((r.end - r.start) * 100) / 100,
      label: `Silêncio ${i + 1}`,
      reason: "Pausa/silêncio detectado por IA.",
    }));

    if (analysis) {
      setAnalysis((current) => current ? {
        ...current,
        events: [...current.events, ...newCuts],
      } : null);
      setReview((current) => ({
        ...current,
        addedEvents: [...(current.addedEvents || []), ...newCuts],
      }));
      setPreviewStale(true);
    } else {
      setPendingSourceCuts((current) => [...current, ...newCuts]);
    }
    setShowSilenceModal(false);
    onStatusMessage({ text: `${newCuts.length} silêncio(s) removidos automaticamente!`, type: "success" });
  }, [analysis, onStatusMessage]);

  const stepPlayhead = useCallback((deltaSeconds: number) => {
    const newTime = Math.max(0, Math.min(timelineDuration, playheadTime + deltaSeconds));
    const rounded = Math.round(newTime * 100) / 100;
    setPlayheadTime(rounded);
    if (videoRef.current) {
      videoRef.current.currentTime = rounded;
    }
  }, [playheadTime, timelineDuration]);

  const changePlaybackSpeed = useCallback((direction: number) => {
    const speeds = [0.5, 1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = Math.max(0, Math.min(speeds.length - 1, (currentIndex === -1 ? 1 : currentIndex) + direction));
    const nextSpeed = speeds[nextIndex];
    setPlaybackSpeed(nextSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
  }, [playbackSpeed]);

  function handleVideoTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    const player = event.currentTarget;
    if (activeMediaAsset === "source" && liveCutPreview && activeCutRanges.length) {
      const skip = nextPlayheadAfterCuts(player.currentTime, activeCutRanges);
      if (skip.jumped) {
        player.currentTime = Math.min(player.duration, skip.newTime);
        if (!isScrubbingRef.current) setPlayheadTime(player.currentTime);
        return;
      }
    }
    if (!isScrubbingRef.current) {
      setPlayheadTime(player.currentTime);
    }
  }

  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => undefined);
    }
    setIsPlaying((prev) => !prev);
  }, [isPlaying]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayPause();
      } else if (event.key === "s" || event.key === "S" || event.key === "c" || event.key === "C") {
        event.preventDefault();
        splitAtPlayhead();
      } else if (event.key === "i" || event.key === "I") {
        event.preventDefault();
        markIn();
      } else if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        markOut();
      } else if (event.key === "q" || event.key === "Q") {
        event.preventDefault();
        trimClipInAtPlayhead();
      } else if (event.key === "w" || event.key === "W") {
        event.preventDefault();
        trimClipOutAtPlayhead();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (inPoint !== null && outPoint !== null) {
          event.preventDefault();
          deleteInOutRange();
        } else if (selectedClipId) {
          event.preventDefault();
          deleteSelectedClip();
        }
      } else if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        changePlaybackSpeed(-1);
      } else if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        if (videoRef.current) videoRef.current.pause();
        setIsPlaying(false);
      } else if (event.key === "l" || event.key === "L") {
        event.preventDefault();
        changePlaybackSpeed(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / 30;
        stepPlayhead(-step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / 30;
        stepPlayhead(step);
      } else if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        undoLastRemovalCut();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    changePlaybackSpeed,
    deleteInOutRange,
    deleteSelectedClip,
    inPoint,
    markIn,
    markOut,
    outPoint,
    selectedClipId,
    splitAtPlayhead,
    stepPlayhead,
    togglePlayPause,
    trimClipInAtPlayhead,
    trimClipOutAtPlayhead,
    undoLastRemovalCut,
  ]);

  function toggleMute() {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  }

  function toggleFullscreen() {
    videoRef.current?.requestFullscreen().catch(() => undefined);
  }

  function downloadLessonFiles() {
    if (!videoMediaSrc || !analysis) return;
    const urls = [
      `${videoMediaSrc}&download=true`,
      `/api/davinci-free/media?planId=${analysis.id}&asset=transcript&download=true`,
    ];
    for (const url of urls) {
      const link = document.createElement("a");
      link.href = url;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    onStatusMessage({ text: "Download do vídeo e da transcrição TXT iniciado.", type: "success" });
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
    <div className="video-editor-system flex min-h-full w-full flex-col bg-[#090A0D] pb-24 text-[#F4F5F7]">
      {/* Workstation Header Bar (Stitch TopNavBar) */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-[#101217] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="kaoz-signal-project flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#1D2028] font-bold text-[#A99FFF]">
              <Video size={16} />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#8B92A1]">01 / Projeto · Kaoz.1 Studio</p>
              <p className="truncate text-sm font-semibold text-[#F4F5F7]">
                {form.lessonNumber ? `${form.lessonNumber} · ` : ""}{form.lessonName || form.moduleName || "Aula sem título"}
              </p>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <nav className="flex items-center gap-1 rounded-[6px] bg-[#090A0D]/70 p-1">
            <button
              onClick={() => setActiveMode("single")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                activeMode === "single"
                  ? "bg-[#242832] text-[#F4F5F7]"
                  : "text-[#8B92A1] hover:bg-[#171A21] hover:text-[#F4F5F7]"
              }`}
            >
              <Film size={14} />
              Single Edit (Aula Única)
            </button>
            <button
              onClick={() => setActiveMode("batch")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                activeMode === "batch"
                  ? "bg-[#242832] text-[#F4F5F7]"
                  : "text-[#8B92A1] hover:bg-[#171A21] hover:text-[#F4F5F7]"
              }`}
            >
              <ListVideo size={14} />
              Batch Processing (Lote)
            </button>
          </nav>
        </div>

        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium ${
              status?.runnerInstalled
                ? "text-emerald-300"
                : "text-amber-300"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status?.runnerInstalled ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
            />
            {status?.runnerInstalled ? "Runner: Online" : "Runner ainda não instalado"}
          </span>

          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-[#D5D8E0]">
            <span className="h-2 w-2 rounded-full bg-[#8B92A1]" />
            Resolve
          </span>

          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-[#D5D8E0]">
            <Sparkles size={13} className="text-[#8B92A1]" />
            AI ativa
          </span>

          <button
            onClick={() => refresh()}
            className="flex items-center justify-center rounded-[6px] p-1.5 text-[#8B92A1] transition-colors hover:bg-white/[0.06] hover:text-[#F4F5F7]"
            title="Atualizar"
          >
            <RefreshCw size={14} className={busy === "refresh" ? "animate-spin text-emerald-400" : ""} />
          </button>
        </div>
      </header>

      {/* Editor inteligente para DaVinci Resolve Free Banner */}
      <div className="grid shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0D0F14] px-4 py-2 text-xs lg:grid-cols-12 lg:gap-4">
        <h2 className="flex items-center gap-2 font-medium text-[#8B92A1] lg:col-span-3">
          <Sparkles size={14} className="text-[#383D49]" />
          Editor inteligente para DaVinci Resolve Free
        </h2>
        {processingProgress && (
          <div className="flex w-full items-center gap-3 rounded-[6px] bg-[#171A21] px-3 py-1.5 lg:col-span-6 lg:col-start-4" aria-live="polite">
            <span className="shrink-0 font-medium text-[#D5D8E0]">{processingProgress.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#090A0D]">
              <div
                className="h-full rounded-full bg-[#7C6CF2] transition-[width] duration-300"
                style={{ width: `${processingProgress.progress}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-[#F4F5F7]">{processingProgress.progress}%</span>
            <span className="max-w-48 truncate text-[10px] text-zinc-400">{processingProgress.stage}</span>
          </div>
        )}
      </div>

      {!status?.runnerInstalled && (
        <div className="mx-4 my-2 flex shrink-0 items-center justify-between gap-3 rounded-[6px] bg-[#171A21] px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-[#D5D8E0]">
            <span className="text-amber-400" aria-hidden="true">●</span>
            Resolve Runner não instalado
          </span>
          <button
            disabled={!!busy}
            onClick={() =>
              action("install", { requestId: `install-${crypto.randomUUID()}` })
            }
            className="inline-flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs font-semibold text-[#A99FFF] transition-colors hover:bg-[#7C6CF2]/10 disabled:opacity-50"
          >
            {busy === "install" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            Instalar
          </button>
        </div>
      )}

      {/* Visão de Aula Única (Workstation 3-Pane) */}
      {activeMode === "single" && (
        <div className="grid flex-none items-stretch gap-0 border-t border-[#383D49]/35 bg-[#090A0D] lg:h-[980px] lg:grid-cols-12 lg:overflow-hidden 2xl:h-[calc(100dvh-9.5rem)] 2xl:min-h-[1100px]">
          {/* PAINEL ESQUERDO: SideNavBar / Project Config */}
          <aside className="order-2 flex min-h-0 min-w-0 flex-col space-y-4 overflow-hidden border-t border-white/[0.07] bg-[#101217] p-4 lg:order-1 lg:col-span-3 lg:h-full lg:border-r lg:border-t-0">
            <div className="border-b border-white/[0.07] pb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[#F4F5F7]">
                <Folder size={14} />
                Configuração da edição
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-[#8B92A1]">Identidade, ritmo e tratamento de áudio da aula.</p>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto pr-1 pb-3 text-xs">
              {/* Video Metadata */}
              <div className="space-y-2">
                <span className="block border-b border-[#383D49]/30 pb-2 text-[10px] font-bold uppercase tracking-widest text-[#8B92A1]">
                  Contexto da aula
                </span>
                <label className="block space-y-1.5 font-semibold text-[#D5D8E0]">
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
                      disabled={busy === "upload-video"}
                      onClick={() => void chooseSingleVideo()}
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] bg-[#242832] px-3 py-1.5 text-xs font-semibold text-[#F4F5F7] transition-colors hover:bg-[#303541]"
                      title="Clique para escolher o arquivo de vídeo da aula"
                    >
                      {busy === "upload-video"
                        ? <Loader2 size={14} className="animate-spin text-[#A99FFF]" />
                        : <Video size={14} className="text-[#A99FFF]" />}
                      <span>{busy === "upload-video" ? "Enviando..." : "Selecionar Vídeo"}</span>
                    </button>
                    <input
                      ref={videoFileInputRef}
                      type="file"
                      accept=".mp4,.mov,.mxf,.avi,.mkv,.webm"
                      className="hidden"
                      onChange={(event) => void uploadWebVideo(event)}
                    />
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
                      lessonName: current.lessonName || selection.name.replace(/\.[^.]+$/, ""),
                    }));
                  }}
                  onStatusMessage={onStatusMessage}
                />

                <label className="block space-y-1.5 font-medium text-[#D5D8E0]">
                  Nome do curso (identidade compartilhada)
                  <input className={fieldClass} value={form.courseName} onChange={update("courseName")} />
                </label>

                <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
                  <label className="block space-y-1.5 font-medium text-[#D5D8E0]">
                    Nome do módulo
                    <input className={fieldClass} value={form.moduleName} onChange={update("moduleName")} />
                  </label>
                  <label className="block space-y-1.5 font-medium text-[#D5D8E0]">
                    Nº da aula
                    <input className={fieldClass} value={form.lessonNumber} onChange={update("lessonNumber")} inputMode="numeric" maxLength={12} />
                  </label>
                </div>

                <label className="block space-y-1.5 font-medium text-[#D5D8E0]">
                  Nome da aula <span className="font-normal text-[#8B92A1]">(tema base e nome do arquivo)</span>
                  <input className={fieldClass} value={form.lessonName} onChange={update("lessonName")} />
                </label>
              </div>

              {/* Edit Style */}
              <div className="space-y-3 border-t border-white/[0.07] pt-4">
                <span className="flex items-center gap-1.5 border-b border-[#383D49]/30 pb-2 text-[10px] font-bold uppercase tracking-widest text-[#8B92A1]">
                  <Palette size={12} /> Edição
                </span>
                <label className="block space-y-1.5 font-semibold text-[#D5D8E0]">
                  Estilo / Ritmo
                  <select className={fieldClass} value={form.style} onChange={update("style")}>
                    <option value="subtle">Discreto (Subtle)</option>
                    <option value="balanced">Equilibrado (Balanced)</option>
                    <option value="dynamic">Dinâmico (Dynamic)</option>
                    <option value="meme">🤡 Modo Meme (Edição Cômica)</option>
                  </select>
                </label>

                <label className="block space-y-1.5 font-semibold text-[#D5D8E0]">
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

                <label className="block space-y-1.5 font-semibold text-[#D5D8E0]">
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

                <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] p-2 text-[#D5D8E0] transition-colors hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={form.reuseCourseTheme}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reuseCourseTheme: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded accent-[#383D49]"
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
              <div className="space-y-3 border-t border-white/[0.07] pt-4">
                <span className="flex items-center gap-1.5 border-b border-[#383D49]/30 pb-2 text-[10px] font-bold uppercase tracking-widest text-[#8B92A1]">
                  <Subtitles size={12} /> Áudio e legendas
                </span>

                <div className="space-y-2 rounded-[6px] bg-[#0D0F14] p-3">
                  <label className="block space-y-1.5 font-semibold text-[#D5D8E0]">
                    Modelo de transcricao
                    <select
                      className={fieldClass}
                      value={form.transcriptionModelId}
                      onChange={(event) => setForm((current) => ({ ...current, transcriptionModelId: event.target.value }))}
                    >
                      <option value="">Selecione um modelo local</option>
                      {speechModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.name} · {model.state === "ready" ? "instalado" : "nao instalado"}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5 font-semibold text-[#D5D8E0]">
                    Processamento
                    <select
                      className={fieldClass}
                      value={form.transcriptionDevice}
                      onChange={(event) => setForm((current) => ({ ...current, transcriptionDevice: event.target.value as "auto" | "vulkan" | "cpu" }))}
                    >
                      <option value="auto">Automatico: GPU Vulkan e fallback CPU</option>
                      <option value="vulkan">GPU Vulkan obrigatoria</option>
                      <option value="cpu">Somente CPU</option>
                    </select>
                  </label>
                  {(() => {
                    const model = speechModels.find((item) => item.id === form.transcriptionModelId);
                    if (!model) return <p className="text-[10px] text-amber-200">Escolha um modelo para habilitar a analise.</p>;
                    const activeDownload = ["queued", "downloading", "verifying"].includes(model.state);
                    const progress = Math.min(100, (model.downloadedBytes / Math.max(1, model.sizeBytes)) * 100);
                    return (
                      <div className="rounded-[6px] bg-[#171A21] p-2.5">
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className={model.state === "ready" ? "text-emerald-300" : model.state === "error" ? "text-red-300" : "text-amber-200"}>
                            {model.state === "ready" ? "Modelo pronto" : model.state === "error" ? model.error || "Falha no modelo" : `${formatBytes(model.sizeBytes)} · download necessario`}
                          </span>
                          {model.state !== "ready" && (
                            <button
                              type="button"
                              disabled={speechModelBusy === model.id}
                              onClick={() => void manageSpeechModel(model.id, activeDownload ? "cancel" : "download")}
                              className="rounded-md border border-[#8B92A1]/40 px-2.5 py-1 font-bold uppercase text-[#D5D8E0] disabled:opacity-50"
                            >
                              {activeDownload ? "Cancelar" : "Baixar"}
                            </button>
                          )}
                        </div>
                        {(activeDownload || model.state === "partial") && (
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-[#8B92A1]" style={{ width: `${progress}%` }} /></div>
                        )}
                      </div>
                    );
                  })()}
                  <label className="flex items-center gap-2 text-[10px] text-[#8B92A1]">
                    <input
                      type="checkbox"
                      checked={form.transcriptionAllowCloudFallback}
                      onChange={(event) => setForm((current) => ({ ...current, transcriptionAllowCloudFallback: event.target.checked }))}
                      className="accent-[#8B92A1]"
                    />
                    Permitir fallback pela nuvem se o modelo local falhar
                  </label>
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] p-2 text-[#D5D8E0] transition-colors hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={form.captionsEnabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        captionsEnabled: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded accent-[#383D49]"
                  />
                  <span>
                    <strong className="block text-zinc-100 font-bold text-[11px]">Incluir legendas no vídeo</strong>
                    <span className="text-[10px] text-zinc-400 leading-tight block">
                      Transcrição analisada mesmo com legendas desativadas.
                    </span>
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="space-y-1.5 font-medium text-[#8B92A1]">
                    Música opcional
                    <input className={fieldClass} value={form.musicPath} onChange={update("musicPath")} />
                  </label>
                  <label className="space-y-1.5 font-medium text-[#8B92A1]">
                    Volume Música (dB)
                    <input className={fieldClass} value={form.musicDb} onChange={update("musicDb")} />
                  </label>
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] p-2 text-[#D5D8E0] transition-colors hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={form.sfxEnabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        sfxEnabled: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded accent-[#383D49]"
                  />
                  <span>
                    <strong className="block text-zinc-100 font-bold text-[11px]">Efeitos sonoros imersivos (SFX)</strong>
                    <span className="text-[10px] text-zinc-400 leading-tight block">
                      A IA escolhe entre 9 sons reais conforme fala, ações, capítulos, erros e conclusões.
                    </span>
                  </span>
                </label>

                {form.sfxEnabled && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="space-y-1.5 font-medium text-[#8B92A1]">
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
                    <label className="space-y-1.5 font-medium text-[#8B92A1]">
                      Volume SFX (dB)
                      <input className={fieldClass} value={form.sfxVolumeDb} onChange={update("sfxVolumeDb")} />
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[#383D49]/35 pt-4">
            <button
              disabled={!!busy || !form.sourcePath || !form.courseName || !form.moduleName || !form.lessonNumber || !form.lessonName}
              onClick={analyze}
              className="kaoz-signal-action flex w-full items-center justify-center gap-2 bg-[#7C6CF2] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#8B7CF6] disabled:pointer-events-none disabled:bg-white/5 disabled:text-zinc-500"
            >
              {busy === "analyze" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <WandSparkles size={15} />
              )}
              Analisar áudio e planejar edição
            </button>
            <p className="mt-2 text-center text-[10px] text-[#8B92A1]">Analisa áudio, roteiro e identidade visual antes de gerar a prévia.</p>
            </div>
          </aside>

          {/* PAINEL CENTRAL: Center Workspace (Player & Visual Timeline) */}
          <main className="relative order-1 flex min-h-0 min-w-0 flex-col self-stretch overflow-hidden bg-[#0D0F14] lg:order-2 lg:col-span-6 lg:h-full">
            {/* Player Container */}
            <div className="relative border-b border-white/[0.06] bg-[#0D0F14] p-3">
              <div className="absolute inset-0 bg-[radial-gradient(#242832_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

              <div className="group relative flex w-full aspect-video max-h-[38vh] shrink-0 flex-col items-center justify-center overflow-hidden rounded-[6px] bg-[#090A0D] shadow-[0_12px_32px_rgba(0,0,0,0.28)] ring-1 ring-white/[0.07]">
                {videoMediaSrc ? (
                  <video
                    ref={videoRef}
                    src={videoMediaSrc}
                    preload="metadata"
                    playsInline
                    onTimeUpdate={handleVideoTimeUpdate}
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
                  <div className="flex h-full w-full flex-col items-center justify-center bg-[#101217]/90 p-6 text-center">
                    <Video size={28} className="mb-3 text-[#383D49]" />
                    <p className="text-xs font-medium text-[#D5D8E0]">Nenhum vídeo carregado</p>
                    <p className="mt-1 max-w-md text-[11px] text-[#8B92A1]">
                      Selecione uma fonte para iniciar a análise.
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

                {videoMediaSrc && (
                  <div className="absolute left-3 top-3 flex items-center gap-2">
                    <span className="rounded-md border border-white/15 bg-black/75 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-200">
                      {activeMediaAsset === "preview" ? "Prévia renderizada" : "Vídeo carregado"}
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

            {videoMediaSrc && activeMediaAsset === "source" && (
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#101217] px-3 py-2">
                {/* Left Group: Primary NLE Editing Actions */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A99FFF]">
                    <Scissors size={13} /> Edição & Cortes
                  </span>

                  {/* Split / Fatiar no Playhead (S) */}
                  <button
                    type="button"
                    onClick={splitAtPlayhead}
                    className="flex items-center gap-1 rounded border border-[#7C6CF2]/40 bg-[#7C6CF2]/15 px-2.5 py-1 text-[10px] font-semibold text-[#D5D8E0] transition hover:bg-[#7C6CF2]/30 hover:text-white"
                    title="Fatiar clipe na agulha atual (Atalho: S ou C)"
                  >
                    <Split size={12} className="text-[#A99FFF]" />
                    Fatiar (S)
                  </button>

                  {/* Mark In (I) & Mark Out (O) */}
                  <div className="flex items-center rounded border border-white/10 bg-[#171A21] p-0.5">
                    <button
                      type="button"
                      onClick={markIn}
                      className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold transition ${
                        inPoint !== null
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "text-zinc-400 hover:text-white"
                      }`}
                      title="Marcar Ponto de Entrada (Atalho: I)"
                    >
                      [ In {inPoint !== null ? clock(inPoint) : ""}
                    </button>
                    <button
                      type="button"
                      onClick={markOut}
                      className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold transition ${
                        outPoint !== null
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "text-zinc-400 hover:text-white"
                      }`}
                      title="Marcar Ponto de Saída (Atalho: O)"
                    >
                      Out ] {outPoint !== null ? clock(outPoint) : ""}
                    </button>
                    {(inPoint !== null || outPoint !== null) && (
                      <button
                        type="button"
                        onClick={clearInOut}
                        className="px-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                        title="Limpar seleção In/Out"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  {/* Ripple Delete In/Out Range */}
                  {inPoint !== null && outPoint !== null && (
                    <button
                      type="button"
                      onClick={deleteInOutRange}
                      className="flex items-center gap-1 rounded border border-red-500/60 bg-red-950/70 px-2.5 py-1 text-[10px] font-bold text-red-200 animate-pulse transition hover:bg-red-900"
                      title="Excluir trecho selecionado [In - Out] (Atalho: Del / Backspace)"
                    >
                      <Trash2 size={11} />
                      Excluir Seleção ({clock(Math.min(inPoint, outPoint))} - {clock(Math.max(inPoint, outPoint))})
                    </button>
                  )}

                  {/* Ripple Trim In (Q) & Ripple Trim Out (W) */}
                  <button
                    type="button"
                    onClick={trimClipInAtPlayhead}
                    className="rounded border border-white/10 bg-[#171A21] px-2 py-1 text-[10px] font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
                    title="Cortar do início do clipe ativo até a agulha (Atalho: Q)"
                  >
                    Trim In (Q)
                  </button>
                  <button
                    type="button"
                    onClick={trimClipOutAtPlayhead}
                    className="rounded border border-white/10 bg-[#171A21] px-2 py-1 text-[10px] font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
                    title="Cortar da agulha até o fim do clipe ativo (Atalho: W)"
                  >
                    Trim Out (W)
                  </button>

                  {/* Auto-Cut Silences Trigger */}
                  <button
                    type="button"
                    onClick={() => setShowSilenceModal(true)}
                    className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-950/30 px-2.5 py-1 text-[10px] font-bold text-emerald-300 transition hover:bg-emerald-900/50"
                    title="Detectar silêncios e pausas longas automaticamente"
                  >
                    <WandSparkles size={12} className="text-emerald-400" />
                    Auto-Corte Silêncios ({detectedSilences.length})
                  </button>
                </div>

                {/* Right Group: Live Preview Skip Toggle & Undo */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLiveCutPreview((v) => !v)}
                    className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold transition ${
                      liveCutPreview
                        ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                        : "border-white/10 bg-[#171A21] text-zinc-400 hover:text-white"
                    }`}
                    title={liveCutPreview ? "Pulo automático de cortes ao vivo ATIVADO" : "Pulo automático DESATIVADO"}
                  >
                    <Zap size={11} className={liveCutPreview ? "text-emerald-400 fill-current" : ""} />
                    {liveCutPreview ? "Prévia c/ Cortes Ativa" : "Pular Cortes (Off)"}
                  </button>

                  <button
                    type="button"
                    onClick={undoLastRemovalCut}
                    disabled={!sourceCutEvents.length}
                    className="flex items-center gap-1 rounded border border-white/10 bg-[#171A21] px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-white/10 disabled:opacity-30"
                    title="Desfazer último corte (Ctrl+Z)"
                  >
                    <RotateCcw size={11} />
                    Desfazer
                  </button>

                  <span className="hidden xl:inline text-[10px] font-mono text-zinc-500">
                    {sourceCutEvents.length} corte(s) | {activeClips.length} clipe(s)
                  </span>
                </div>
              </div>
            )}

            {/* Visual Multi-Track Timeline (7 Linhas Profissionais) */}
            <div className="h-[360px] flex shrink-0 flex-col border-t border-white/[0.07] bg-[#0B0D12]">
              {/* Timeline Header Toolbar */}
              <div className="flex h-9 items-center justify-between border-b border-white/[0.06] bg-[#101217] px-3 text-[#8B92A1]">
                <div className="flex items-center gap-2 text-xs">
                  <span className="mr-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#A99FFF] flex items-center gap-1">
                    <Layers size={11} /> 04 / Timeline Multi-Track
                  </span>

                  <button
                    onClick={addEventAtPlayhead}
                    className="flex items-center gap-1 rounded border border-[#8B92A1]/35 bg-[#383D49]/25 px-2 py-0.5 text-[10px] font-bold text-[#D5D8E0] transition-all hover:bg-[#383D49]/45"
                    title="Inserir evento no corte"
                  >
                    <Plus size={13} />
                    Adicionar Evento
                  </button>

                  <div className="w-px h-3.5 bg-white/10 mx-1" />

                  {/* Zoom Controls */}
                  <button
                    onClick={() => setTimelineScale((s) => Math.min(4, s + 0.25))}
                    className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
                    title="Aproximar Zoom (Zoom In)"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={() => setTimelineScale((s) => Math.max(1, s - 0.25))}
                    className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
                    title="Afastar Zoom (Zoom Out)"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span className="text-[10px] font-mono text-zinc-500">{(timelineScale * 100).toFixed(0)}%</span>

                  <div className="mx-1 h-3.5 w-px bg-white/10" />

                  {/* Frame Step Back / Forward */}
                  <button
                    type="button"
                    onClick={() => stepPlayhead(-1 / 30)}
                    disabled={!videoMediaSrc}
                    className="p-1 rounded text-zinc-400 hover:bg-white/10 hover:text-white transition disabled:opacity-30"
                    title="Voltar 1 frame (Seta Esquerda)"
                  >
                    <Rewind size={13} />
                  </button>

                  {/* Play / Pause */}
                  <button
                    onClick={togglePlayPause}
                    disabled={!videoMediaSrc}
                    className="rounded p-1 transition-colors hover:bg-white/10 hover:text-emerald-400 disabled:opacity-30"
                    title={isPlaying ? "Pausar (Espaço)" : "Reproduzir (Espaço)"}
                  >
                    {isPlaying
                      ? <Pause size={14} className="fill-current text-emerald-400" />
                      : <Play size={14} className="fill-current" />}
                  </button>

                  {/* Step Forward 1 frame */}
                  <button
                    type="button"
                    onClick={() => stepPlayhead(1 / 30)}
                    disabled={!videoMediaSrc}
                    className="p-1 rounded text-zinc-400 hover:bg-white/10 hover:text-white transition disabled:opacity-30"
                    title="Avançar 1 frame (Seta Direita)"
                  >
                    <FastForward size={13} />
                  </button>

                  {/* Timecode clock */}
                  <span className="min-w-[76px] text-[10px] font-mono font-bold text-[#D5D8E0]">
                    {clock(playheadTime)} / {clock(timelineDuration)}
                  </span>

                  {/* Playback speed selector */}
                  <button
                    type="button"
                    onClick={() => changePlaybackSpeed(1)}
                    className="rounded bg-[#171A21] px-1.5 py-0.5 text-[9px] font-mono font-bold text-zinc-300 hover:bg-white/10 hover:text-white"
                    title="Alterar velocidade de reprodução (J/K/L)"
                  >
                    {playbackSpeed}x
                  </button>

                  <div className="mx-1 h-3.5 w-px bg-white/10" />

                  <button
                    onClick={toggleMute}
                    disabled={!videoMediaSrc}
                    className="rounded p-1 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                    title={isMuted ? "Ativar áudio" : "Silenciar"}
                  >
                    {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>

                  {videoMediaSrc && (
                    <button
                      type="button"
                      onClick={downloadLessonFiles}
                      title="Baixar vídeo e transcrição TXT"
                      className="rounded p-1 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Download size={14} />
                    </button>
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

                <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
                  {activeMediaAsset === "source" && activeCutRanges.length > 0 && (
                    <span className="text-amber-400/90 font-medium">
                      Editado: {clock(editedVideoDuration(analysis?.events || pendingSourceCuts, timelineDuration))}
                    </span>
                  )}
                  <span>Bruto: {clock(timelineDuration)}</span>
                </div>
              </div>

              {/* Tracks Area */}
              <div className="flex-1 overflow-x-auto overflow-y-auto">
                <div
                  onMouseDown={handleTimelineMouseDown}
                  onClick={handleTimelineClick}
                  className="min-h-full min-w-full flex flex-col cursor-crosshair select-none pb-2"
                  style={{ width: `${100 * timelineScale}%` }}
                >
                  {/* Régua / Timecode Header (TC) */}
                  <div className="grid h-6 shrink-0 grid-cols-[40px_minmax(0,1fr)] items-end border-b border-white/5 px-3">
                    <span className="pb-1 text-[8px] font-mono text-zinc-600 font-bold">TC</span>
                    <div className="relative h-full select-none">
                      {/* Highlighted In/Out Range Banner */}
                      {inPoint !== null && outPoint !== null && Math.abs(outPoint - inPoint) > 0.05 && (
                        <div
                          className="pointer-events-none absolute bottom-0 top-1 rounded-[2px] bg-amber-500/20 border-x-2 border-amber-400/80 z-10 flex items-center justify-between px-1"
                          style={{
                            left: `${(Math.min(inPoint, outPoint) / timelineDuration) * 100}%`,
                            width: `${(Math.abs(outPoint - inPoint) / timelineDuration) * 100}%`,
                          }}
                        >
                          <span className="text-[7px] font-mono font-bold text-amber-300">[ In</span>
                          <span className="text-[7px] font-mono font-bold text-amber-300">Out ]</span>
                        </div>
                      )}

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
                    {/* Playhead Vertical Cursor */}
                    <div
                      ref={timelineTrackRef}
                      className="absolute bottom-3 left-[52px] right-3 top-2 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px)] [background-size:40px_100%]"
                    >
                      <div
                        className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-[#7C6CF2] shadow-[0_0_12px_rgba(124,108,242,0.95)] transition-all duration-75"
                        style={{ left: `${Math.min(100, Math.max(0, (playheadTime / timelineDuration) * 100))}%` }}
                      >
                        <div className="absolute -top-1.5 h-3 w-3 -translate-x-1/2 bg-[#A99FFF] [clip-path:polygon(0_0,100%_0,50%_100%)] shadow-md" />
                      </div>
                    </div>

                    <div className="relative z-10 flex h-full flex-col gap-1.5 pointer-events-none">

                      {/* 1. Track V2 (B-Roll, Overlays, Zooms, Transições) */}
                      <div className="grid h-8 grid-cols-[40px_minmax(0,1fr)] items-center rounded-[4px] bg-[#101217] pointer-events-auto border border-white/[0.03]">
                        <span className="pl-2 text-[9px] font-mono font-bold text-cyan-400/80">V2</span>
                        <div className="relative h-full flex-1 overflow-hidden">
                          {timelineEvents.filter((evt) => ["zoom", "transition", "intro", "outro"].includes(evt.kind)).length > 0 ? (
                            timelineEvents
                              .filter((evt) => ["zoom", "transition", "intro", "outro"].includes(evt.kind))
                              .map((evt) => {
                                const change = eventReview(evt);
                                const enabled = change.enabled !== false;
                                const evtStart = change.start ?? evt.start;
                                const evtDuration = change.duration ?? evt.duration;
                                const playerEventStart = eventPlayerTime(evt, evtStart);
                                const leftPct = (playerEventStart / timelineDuration) * 100;
                                const widthPct = Math.max(1.5, Math.min(100 - leftPct, (evtDuration / timelineDuration) * 100));
                                const isSelected = selectedEventId === evt.id;

                                return (
                                  <div
                                    key={evt.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectEvent(evt.id, playerEventStart);
                                    }}
                                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                    className={`absolute top-1 bottom-1 px-1.5 rounded-[3px] text-[8px] font-mono font-bold border flex items-center justify-between cursor-pointer transition-all ${
                                      isSelected
                                        ? "kaoz-signal-clip z-10"
                                        : enabled
                                          ? "bg-cyan-950/80 border-cyan-500/60 text-cyan-200 hover:brightness-125"
                                          : "bg-zinc-900 border-zinc-700 text-zinc-500 opacity-40"
                                    }`}
                                    title={`${kindLabel[evt.kind]}: ${evt.label} (${clock(playerEventStart)})`}
                                  >
                                    <span className="truncate">{kindLabel[evt.kind]}: {evt.label}</span>
                                    <span className="text-[7px] opacity-75 font-mono ml-1">{clock(playerEventStart)}</span>
                                  </div>
                                );
                              })
                          ) : (
                            <span className="pl-2 text-[8px] italic text-zinc-600">Zooms, cortes de câmera e transições</span>
                          )}
                        </div>
                      </div>

                      {/* 2. Track V1 (Vídeo Principal & Clipes Fatiados) */}
                      <div className="grid h-10 grid-cols-[40px_minmax(0,1fr)] items-center rounded-[4px] bg-[#13161C] pointer-events-auto border border-white/[0.04]">
                        <span className="pl-2 text-[10px] font-mono font-bold text-zinc-400">V1</span>
                        <div className="relative h-full flex-1 overflow-hidden">
                          {activeMediaAsset === "preview" ? (
                            <>
                              <div
                                className="absolute top-1 bottom-1 flex items-center truncate rounded border border-[#383D49]/45 bg-[#171A21]/65 px-2 font-mono text-[10px] text-[#D5D8E0]"
                                style={{ left: 0, width: `${(4 / timelineDuration) * 100}%` }}
                              >
                                Intro
                              </div>
                              <div
                                className="kaoz-signal-clip absolute top-1 bottom-1 flex items-center truncate px-2 font-mono text-[10px] font-bold"
                                style={{
                                  left: `${(4 / timelineDuration) * 100}%`,
                                  width: `${((analysis ? editedVideoDuration(analysis.events, analysis.media.durationSeconds) : (timelineDuration - 8)) / timelineDuration) * 100}%`,
                                }}
                              >
                                A-Roll ({form.lessonName || form.moduleName || "Ativo"})
                              </div>
                              <div
                                className="absolute top-1 bottom-1 flex items-center truncate rounded border border-[#383D49]/45 bg-[#171A21]/65 px-2 font-mono text-[10px] text-[#D5D8E0]"
                                style={{
                                  left: `${(((analysis ? editedVideoDuration(analysis.events, analysis.media.durationSeconds) : (timelineDuration - 8)) + 4) / timelineDuration) * 100}%`,
                                  width: `${(4 / timelineDuration) * 100}%`,
                                }}
                              >
                                Outro
                              </div>
                            </>
                          ) : (
                            <>
                              {/* Clipes Ativos Fatiados */}
                              {activeClips.map((clip) => {
                                const leftPct = (clip.start / timelineDuration) * 100;
                                const widthPct = Math.max(0.8, (clip.duration / timelineDuration) * 100);
                                const isSelected = selectedClipId === clip.id;

                                return (
                                  <div
                                    key={clip.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedClipId(clip.id);
                                      setPlayheadTime(clip.start);
                                      if (videoRef.current) videoRef.current.currentTime = clip.start;
                                    }}
                                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                    className={`group/clip absolute top-1 bottom-1 px-2 rounded-[4px] border flex items-center justify-between transition-all cursor-pointer select-none ${
                                      isSelected
                                        ? "bg-[#252a3a] border-[#A99FFF] ring-2 ring-[#7C6CF2] z-20 shadow-lg text-white"
                                        : "bg-gradient-to-r from-[#171A21] to-[#202533] border-[#7C6CF2]/40 text-[#D5D8E0] hover:border-[#7C6CF2] hover:brightness-110"
                                    }`}
                                    title={`Clipe ${clip.index + 1} (${clock(clip.start)} - ${clock(clip.end)} | ${clip.duration.toFixed(1)}s)`}
                                  >
                                    {/* Left Trim Handle */}
                                    <div
                                      className="absolute left-0 top-0 bottom-0 w-2.5 bg-[#7C6CF2]/30 hover:bg-[#A99FFF] cursor-ew-resize rounded-l-[3px] flex items-center justify-center opacity-0 group-hover/clip:opacity-100 transition"
                                      title="Alça de ajuste: Início do clipe"
                                    >
                                      <div className="w-0.5 h-3 bg-white/70" />
                                    </div>

                                    <div className="flex items-center gap-1.5 truncate pl-1 min-w-0">
                                      <span className="font-mono text-[9px] font-bold text-white truncate">
                                        Clipe {clip.index + 1}
                                      </span>
                                      <span className="font-mono text-[8px] text-zinc-400 truncate hidden sm:inline">
                                        ({clock(clip.start)} - {clock(clip.end)})
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0 ml-1">
                                      <span className="rounded bg-black/40 px-1 py-0.5 font-mono text-[8px] text-[#A99FFF]">
                                        {clip.duration.toFixed(1)}s
                                      </span>
                                    </div>

                                    {/* Right Trim Handle */}
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-2.5 bg-[#7C6CF2]/30 hover:bg-[#A99FFF] cursor-ew-resize rounded-r-[3px] flex items-center justify-center opacity-0 group-hover/clip:opacity-100 transition"
                                      title="Alça de ajuste: Fim do clipe"
                                    >
                                      <div className="w-0.5 h-3 bg-white/70" />
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Trechos Cortados / Removidos */}
                              {activeCutRanges.map((cut, idx) => {
                                const leftPct = (cut.start / timelineDuration) * 100;
                                const cutDuration = cut.end - cut.start;
                                const widthPct = Math.max(0.8, (cutDuration / timelineDuration) * 100);
                                const matchingEvent = sourceCutEvents.find(
                                  (e) => Math.abs(e.start - cut.start) < 0.2,
                                );

                                return (
                                  <div
                                    key={`cut-${idx}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPlayheadTime(cut.start);
                                      if (videoRef.current) videoRef.current.currentTime = cut.start;
                                    }}
                                    style={{
                                      left: `${leftPct}%`,
                                      width: `${widthPct}%`,
                                      background: "repeating-linear-gradient(45deg, rgba(239,68,68,0.25), rgba(239,68,68,0.25) 6px, rgba(15,23,42,0.7) 6px, rgba(15,23,42,0.7) 12px)",
                                    }}
                                    className="group/cut absolute top-1 bottom-1 rounded-[4px] border border-dashed border-red-500/70 bg-red-950/80 flex items-center justify-between px-1.5 cursor-pointer z-10 transition hover:brightness-125"
                                    title={`Trecho Removido (${clock(cut.start)} - ${clock(cut.end)} | ${cutDuration.toFixed(1)}s)`}
                                  >
                                    <span className="text-[8px] font-mono font-bold text-red-300 truncate">
                                      Cortado ({cutDuration.toFixed(1)}s)
                                    </span>
                                    {matchingEvent && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeSpecificCut(matchingEvent.id);
                                        }}
                                        className="hidden group-hover/cut:flex items-center gap-0.5 rounded bg-red-800 px-1 py-0.5 text-[8px] font-bold text-white hover:bg-red-700 shadow"
                                        title="Restaurar este corte"
                                      >
                                        <Plus size={9} /> Restaurar
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>

                      {/* 3. Track TXT (Títulos, Lower-Thirds & Legendas) */}
                      <div className="grid h-8 grid-cols-[40px_minmax(0,1fr)] items-center rounded-[4px] bg-[#101217] pointer-events-auto border border-white/[0.03]">
                        <span className="pl-2 text-[9px] font-mono font-bold text-amber-400/80">TXT</span>
                        <div className="relative h-full flex-1 overflow-hidden">
                          {timelineEvents.filter((evt) => ["lower-third", "impact-text"].includes(evt.kind)).length > 0 ? (
                            timelineEvents
                              .filter((evt) => ["lower-third", "impact-text"].includes(evt.kind))
                              .map((evt) => {
                                const change = eventReview(evt);
                                const enabled = change.enabled !== false;
                                const evtStart = change.start ?? evt.start;
                                const evtDuration = change.duration ?? evt.duration;
                                const playerEventStart = eventPlayerTime(evt, evtStart);
                                const leftPct = (playerEventStart / timelineDuration) * 100;
                                const widthPct = Math.max(1.5, Math.min(100 - leftPct, (evtDuration / timelineDuration) * 100));
                                const isSelected = selectedEventId === evt.id;

                                return (
                                  <div
                                    key={evt.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectEvent(evt.id, playerEventStart);
                                    }}
                                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                    className={`absolute top-1 bottom-1 px-1.5 rounded-[3px] text-[8px] font-mono font-bold border flex items-center justify-between cursor-pointer transition-all ${
                                      isSelected
                                        ? "kaoz-signal-clip z-10"
                                        : enabled
                                          ? "bg-amber-950/80 border-amber-500/60 text-amber-200 hover:brightness-125"
                                          : "bg-zinc-900 border-zinc-700 text-zinc-500 opacity-40"
                                    }`}
                                    title={`Texto: ${evt.label} (${clock(playerEventStart)})`}
                                  >
                                    <span className="truncate">{evt.label}</span>
                                    <span className="text-[7px] opacity-75 font-mono ml-1">{clock(playerEventStart)}</span>
                                  </div>
                                );
                              })
                          ) : (
                            <span className="pl-2 text-[8px] italic text-zinc-600">Lower-thirds, títulos de destaque e legendas</span>
                          )}
                        </div>
                      </div>

                      {/* 4. Track FX (Efeitos Especiais & Memes) */}
                      <div className="grid h-8 grid-cols-[40px_minmax(0,1fr)] items-center rounded-[4px] bg-[#101217] pointer-events-auto border border-white/[0.03]">
                        <span className="pl-2 text-[9px] font-mono font-bold text-purple-400/80">FX</span>
                        <div className="relative h-full flex-1 overflow-hidden">
                          {timelineEvents.filter((evt) => ["sound-effect", "meme-sfx", "cursor"].includes(evt.kind)).length > 0 ? (
                            timelineEvents
                              .filter((evt) => ["sound-effect", "meme-sfx", "cursor"].includes(evt.kind))
                              .map((evt) => {
                                const change = eventReview(evt);
                                const enabled = change.enabled !== false;
                                const evtStart = change.start ?? evt.start;
                                const evtDuration = change.duration ?? evt.duration;
                                const playerEventStart = eventPlayerTime(evt, evtStart);
                                const leftPct = (playerEventStart / timelineDuration) * 100;
                                const widthPct = Math.max(1.5, Math.min(100 - leftPct, (evtDuration / timelineDuration) * 100));
                                const isSelected = selectedEventId === evt.id;

                                return (
                                  <div
                                    key={evt.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectEvent(evt.id, playerEventStart);
                                    }}
                                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                    className={`absolute top-1 bottom-1 px-1.5 rounded-[3px] text-[8px] font-mono font-bold border flex items-center justify-between cursor-pointer transition-all ${
                                      isSelected
                                        ? "kaoz-signal-clip z-10"
                                        : enabled
                                          ? "bg-purple-950/80 border-purple-500/60 text-purple-200 hover:brightness-125"
                                          : "bg-zinc-900 border-zinc-700 text-zinc-500 opacity-40"
                                    }`}
                                    title={`Efeito: ${evt.label} (${clock(playerEventStart)})`}
                                  >
                                    <span className="truncate">{evt.memeTag || evt.label}</span>
                                    <span className="text-[7px] opacity-75 font-mono ml-1">{clock(playerEventStart)}</span>
                                  </div>
                                );
                              })
                          ) : (
                            <span className="pl-2 text-[8px] italic text-zinc-600">Efeitos sonoros, animações e memes</span>
                          )}
                        </div>
                      </div>

                      {/* 5. Track A1 (Áudio Principal / Waveform SVG) */}
                      <div className="grid h-9 grid-cols-[40px_minmax(0,1fr)] items-center rounded-[4px] bg-[#13161C] pointer-events-auto border border-white/[0.04]">
                        <span className="pl-2 text-[10px] font-mono font-bold text-emerald-400">A1</span>
                        <div className="relative flex-1 h-full flex items-center overflow-hidden">
                          {waveformBusy && !waveform.length ? (
                            <span className="flex items-center gap-1 pl-2 text-[9px] text-zinc-500">
                              <Loader2 size={10} className="animate-spin" />
                              Lendo áudio
                            </span>
                          ) : waveform.length ? (
                            <div className="relative w-full h-full flex items-center">
                              <svg
                                className="w-full h-full block pointer-events-none"
                                viewBox={`0 0 ${waveform.length} 100`}
                                preserveAspectRatio="none"
                              >
                                <defs>
                                  <clipPath id="waveform-played-clip">
                                    <rect
                                      x="0"
                                      y="0"
                                      width={`${Math.min(100, Math.max(0, (playheadTime / timelineDuration) * 100))}%`}
                                      height="100"
                                    />
                                  </clipPath>
                                </defs>
                                {/* Unplayed Background Waveform */}
                                <g fill="#047857">
                                  {waveform.map((peak, index) => {
                                    const barHeight = peak <= 0 ? 3 : Math.max(8, peak * 92);
                                    const y = (100 - barHeight) / 2;
                                    return (
                                      <rect
                                        key={index}
                                        x={index + 0.1}
                                        y={y}
                                        width={0.8}
                                        height={barHeight}
                                        rx={0.3}
                                      />
                                    );
                                  })}
                                </g>
                                {/* Played Highlighted Waveform */}
                                <g fill="#6ee7b7" clipPath="url(#waveform-played-clip)">
                                  {waveform.map((peak, index) => {
                                    const barHeight = peak <= 0 ? 3 : Math.max(8, peak * 92);
                                    const y = (100 - barHeight) / 2;
                                    return (
                                      <rect
                                        key={index}
                                        x={index + 0.1}
                                        y={y}
                                        width={0.8}
                                        height={barHeight}
                                        rx={0.3}
                                      />
                                    );
                                  })}
                                </g>
                              </svg>
                            </div>
                          ) : (
                            <span className="pl-2 text-[9px] italic text-zinc-600">Faixa de áudio indisponível</span>
                          )}
                        </div>
                      </div>

                      {/* 6. Track A2 (Música de Fundo / Trilha Sonora) */}
                      {musicWaveform.length > 0 && (
                        <div className="grid h-8 grid-cols-[40px_minmax(0,1fr)] items-center rounded-[4px] bg-[#13161C] pointer-events-auto border border-white/[0.04]">
                          <span className="pl-2 text-[10px] font-mono font-bold text-[#8B92A1]">A2</span>
                          <div className="relative flex-1 h-full flex items-center overflow-hidden">
                            <svg
                              className="w-full h-full block pointer-events-none"
                              viewBox={`0 0 ${musicWaveform.length} 100`}
                              preserveAspectRatio="none"
                            >
                              <g fill="#475569">
                                {musicWaveform.map((peak, index) => {
                                  const barHeight = peak <= 0 ? 3 : Math.max(6, peak * 82);
                                  const y = (100 - barHeight) / 2;
                                  return (
                                    <rect
                                      key={index}
                                      x={index + 0.1}
                                      y={y}
                                      width={0.8}
                                      height={barHeight}
                                      rx={0.3}
                                    />
                                  );
                                })}
                              </g>
                            </svg>
                            <span className="absolute right-2 text-[8px] font-mono text-[#8B92A1] bg-[#13161C]/80 px-1 py-0.5 rounded border border-white/5">
                              {analysis?.media.musicDb} dB
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="min-h-[180px] flex-1 overflow-hidden border-t border-white/[0.07] bg-[#0D0F14] p-3">
              <VideoEditorConsole
                logs={consoleLogs}
                onClearLogs={() => setConsoleLogs([])}
                isProcessing={Boolean(busy)}
                fillAvailableHeight
              />
            </div>
          </main>

          {/* PAINEL DIREITO: Right Sidebar (Inspector & AI Insights) */}
          <aside className="order-3 flex min-h-0 min-w-0 flex-col space-y-4 overflow-hidden border-t border-white/[0.07] bg-[#13161C] p-4 font-body-sm lg:col-span-3 lg:h-full lg:border-l lg:border-t-0">
            <div className="kaoz-signal-inspector border-b border-white/[0.07] pb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[#F4F5F7]">
                <Sparkles size={14} className="text-[#A99FFF]" />
                <span className="font-mono text-[9px] font-medium tracking-[0.14em] text-[#8B92A1]" aria-hidden="true">05 /</span>
                AI Inspector
              </h2>
              <p className="mt-1 text-[11px] text-[#8B92A1]">
                Decisões: <span className="font-medium text-[#D5D8E0]">{analysis?.semantic.source === "agent" ? "agente semântico" : "fallback local"}</span>
                {analysis?.semantic.model ? ` · ${analysis.semantic.model}` : ""}
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-3">
              {/* Course Identity Card */}
              {analysis?.courseTheme && (
              <div className="rounded-[6px] border-l-2 border-l-[#7C6CF2] bg-[#171A21] px-3 py-2.5 text-xs text-[#D5D8E0]">
                <p className="font-bold text-white">
                  Identidade {analysis.courseTheme.reused ? "reutilizada" : "criada"}: {analysis.courseTheme.label}
                </p>
                <p className="text-[11px] text-zinc-300 mt-1 leading-snug">{analysis.courseTheme.rationale}</p>
              </div>
              )}

            {/* Analysis summary */}
            <div className="grid grid-cols-2 border-y border-white/[0.07] py-2">
              {Object.entries(eventCounts).map(([kind, count]) => (
                <div
                  key={kind}
                  className="px-2 py-1.5 text-[10px] text-zinc-400 even:border-l even:border-white/[0.06]"
                >
                  <strong className="block text-sm font-semibold text-zinc-200">{count}</strong>
                  {kindLabel[kind as EditEvent["kind"]]}
                </div>
              ))}
            </div>

            {/* Timeline Editorial & List */}
            <div className="space-y-3">
              <div className="border-b border-white/[0.07] pb-2">
                <div>
                  <h4 className="text-xs font-bold text-white">Timeline editorial</h4>
                  <p className="text-[10px] text-zinc-500">Decisões e ajustes da IA</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    disabled={!!busy}
                    onClick={restoreAutomatic}
                    title="Restaurar edição automática"
                    className="whitespace-nowrap rounded-[6px] px-2 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40"
                  >
                    Restaurar automático
                  </button>
                  <button
                    disabled={!!busy || !analysis?.courseName}
                    onClick={saveCourseStandard}
                    title="Salvar padrão do curso"
                    className="whitespace-nowrap rounded-[6px] bg-[#242832] px-2 py-1 text-[10px] font-medium text-[#D5D8E0] transition-colors hover:bg-[#303541] disabled:opacity-40"
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
                      className={`border-b border-white/10 px-1 py-2.5 transition-colors text-xs cursor-pointer ${
                        isSelected
                          ? "border-l-2 border-l-[#7C6CF2] bg-[#7C6CF2]/[0.08] pl-2"
                          : enabled
                            ? "hover:bg-white/[0.03]"
                            : "opacity-40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(input) => updateEvent(event, { enabled: input.target.checked })}
                          className="h-3.5 w-3.5 rounded accent-[#7C6CF2]"
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
                    className="h-3.5 w-3.5 rounded accent-[#7C6CF2]"
                  />
                  Exibir legendas
                </label>
                {analysis?.captions.slice(0, 5).map((caption, index) => {
                  const change = captionReview(index);
                  const enabled = change.enabled !== false;
                  return (
                    <div key={`caption-${index}`} className="grid gap-1.5 border-b border-white/[0.06] py-2 text-[10px]">
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
            </div>
          </aside>
        </div>
      )}

      {/* Visão de Processamento em Lote (Batch View) */}
      {activeMode === "batch" && (
        <div className="space-y-5 rounded-2xl border border-[#383D49]/50 bg-[#101217]/85 p-6 backdrop-blur-xl shadow-2xl">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#383D49]/25 border border-[#8B92A1]/30 text-[#D5D8E0]">
                <ListVideo size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Editar curso inteiro em lote</h3>
                <p className="text-xs text-[#8B92A1] font-medium">Pipeline Automatizado de Aulas</p>
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

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#383D49]/40 bg-[#090A0D]/55 p-1.5">
            <button
              type="button"
              onClick={() => setBatchSource("local")}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${batchSource === "local" ? "bg-[#383D49] text-white" : "text-zinc-400 hover:bg-white/5"}`}
            >
              Pasta local
            </button>
            <button
              type="button"
              onClick={() => setBatchSource("google-drive")}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${batchSource === "google-drive" ? "bg-[#383D49] text-white" : "text-zinc-400 hover:bg-white/5"}`}
            >
              Google Drive
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-[#383D49]/40 bg-[#090A0D]/65 p-4">
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
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#383D49] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#090A0D]/30 transition-all hover:bg-[#8B92A1] disabled:opacity-40"
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
            <div className="space-y-2 rounded-xl border border-[#383D49]/40 bg-[#171A21]/25 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#D5D8E0]">
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
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#8B92A1]/35 bg-[#383D49]/20 px-3 py-1.5 text-xs font-semibold text-[#D5D8E0] transition-all hover:bg-[#383D49]/35 disabled:opacity-40"
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
            <div className="space-y-4 rounded-xl border border-[#383D49]/50 bg-[#090A0D]/70 p-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-[#D5D8E0]">
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
                  className="w-full rounded-lg border border-white/10 bg-black/60 pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-[#8B92A1]"
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
                            ? "border-[#8B92A1]/40 bg-[#383D49]/25 text-white"
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
                          className="h-4 w-4 rounded border-white/20 bg-black accent-[#383D49]"
                        />
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#383D49]/25 font-mono text-[10px] font-bold text-[#D5D8E0]">
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
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#383D49] px-4 py-3 text-xs font-bold text-white shadow-lg shadow-[#090A0D]/30 transition-all hover:bg-[#8B92A1] disabled:opacity-40"
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
                driveBatchDiscovery.valid ? "border-[#383D49]/45 bg-[#090A0D]/65" : "border-red-500/25 bg-red-500/[0.04]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-[#D5D8E0]">
                    <Film size={15} />
                    Seleção de Aulas do Google Drive
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[11px] text-zinc-400">
                    <span>
                      {selectedDriveLessons.length} de {driveBatchDiscovery.lessons.length} aulas selecionadas
                    </span>
                    <span>·</span>
                    <span className="font-semibold text-[#D5D8E0]">
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
                  className="w-full rounded-lg border border-[#383D49]/40 bg-[#090A0D]/75 pl-8 pr-3 py-1.5 text-xs text-[#D5D8E0] placeholder-[#383D49] outline-none focus:border-[#8B92A1]"
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
                    <div key={module.id} className="space-y-2 rounded-xl border border-[#383D49]/40 bg-[#090A0D]/70 p-3">
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
                            className="h-4 w-4 rounded border-white/20 bg-black accent-[#383D49]"
                          />
                          <span className="text-xs font-bold text-[#D5D8E0]">
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
                                  ? "border-[#8B92A1]/40 bg-[#383D49]/20 text-zinc-100"
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
                                  className="h-3.5 w-3.5 rounded border-white/20 bg-black accent-[#383D49]"
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
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#383D49] px-4 py-3 text-xs font-bold text-white shadow-lg shadow-[#090A0D]/30 transition-all hover:bg-[#8B92A1] disabled:opacity-40"
              >
                {busy === "start-batch" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Iniciar exportação por lote do Drive ({selectedDriveLessons.length} aulas selecionadas)
              </button>
            </div>
          )}

          {batch && (
            <div className="space-y-4 rounded-xl border border-[#383D49]/40 bg-[#090A0D]/65 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-zinc-100">
                    {batch.courseIdentity?.title || batch.courseName} · {batch.completed}/{batch.total} concluídas
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Estado: <span className="font-semibold text-[#D5D8E0]">{batch.status}</span>
                    {batch.failed > 0 ? ` · ${batch.failed} com falha` : ""}
                  </p>
                  {batch.error && <p className="mt-1 text-[10px] text-red-300">{batch.error}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {["queued", "running"].includes(batch.status) && (
                    <button disabled={!!busy} onClick={() => changeBatchState("cancel-batch")} className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-semibold text-red-200 disabled:opacity-40">Cancelar lote</button>
                  )}
                  {batch.status === "cancelled" && (
                    <button disabled={!!busy} onClick={() => changeBatchState("resume-batch")} className="rounded-xl border border-[#8B92A1]/35 bg-[#383D49]/20 px-3 py-1.5 text-xs font-semibold text-[#D5D8E0] disabled:opacity-40">Retomar lote</button>
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
                  className="h-full rounded-full bg-gradient-to-r from-[#383D49] via-[#8B92A1] to-emerald-400 transition-all duration-500"
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
      {activeMode === "batch" && (
        <div className="my-6 pb-16">
          <VideoEditorConsole
            logs={consoleLogs}
            onClearLogs={() => setConsoleLogs([])}
            isProcessing={Boolean(busy)}
          />
        </div>
      )}

      {status?.pendingPlan && (
        <div className="mx-4 my-4 flex shrink-0 items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-xl backdrop-blur-xl">
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

      {/* Auto-Cut Silences Modal */}
      {showSilenceModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="silence-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowSilenceModal(false);
          }}
        >
          <div className="w-full max-w-lg rounded-[8px] border border-white/10 bg-[#13161C] p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-emerald-500/15 text-emerald-400">
                  <WandSparkles size={18} />
                </span>
                <div>
                  <h2 id="silence-modal-title" className="text-sm font-bold text-white">
                    Auto-Corte Inteligente de Silêncios
                  </h2>
                  <p className="text-[11px] text-[#8B92A1]">
                    Identifica pausas longas no waveform para fatiar e remover silêncios instantaneamente.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSilenceModal(false)}
                className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* Silence Summary Card */}
            <div className="rounded-[6px] border border-emerald-500/30 bg-emerald-950/30 p-3 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-200 block">
                  {detectedSilences.length} pausa(s) detectada(s)
                </span>
                <span className="text-[10px] text-emerald-300/80">
                  Economia de tempo estimada: {totalSilenceSeconds.toFixed(1)}s ({clock(totalSilenceSeconds)})
                </span>
              </div>
              <span className="rounded bg-emerald-500/20 px-2 py-1 font-mono text-[11px] font-bold text-emerald-300">
                -{( (totalSilenceSeconds / (timelineDuration || 1)) * 100 ).toFixed(1)}% do vídeo
              </span>
            </div>

            {/* Adjustments */}
            <div className="space-y-3 rounded-[6px] border border-white/5 bg-[#0D0F14] p-3 text-xs">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                Ajustes do Detector
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1 block">
                  <span className="text-[10px] text-zinc-300 font-medium">Sensibilidade (Volume)</span>
                  <select
                    className={fieldClass}
                    value={silenceThreshold}
                    onChange={(e) => setSilenceThreshold(Number(e.target.value))}
                  >
                    <option value={0.02}>Alta (-42 dB)</option>
                    <option value={0.045}>Normal (-35 dB)</option>
                    <option value={0.08}>Baixa (-28 dB)</option>
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[10px] text-zinc-300 font-medium">Duração Mínima</span>
                  <select
                    className={fieldClass}
                    value={silenceMinDuration}
                    onChange={(e) => setSilenceMinDuration(Number(e.target.value))}
                  >
                    <option value={0.25}>0.25s (Jump Cuts rápidos)</option>
                    <option value={0.4}>0.4s (Pausas naturais)</option>
                    <option value={0.8}>0.8s (Apenas pausas longas)</option>
                    <option value={1.5}>1.5s (Silêncios estendidos)</option>
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[10px] text-zinc-300 font-medium">Margem / Padding</span>
                  <select
                    className={fieldClass}
                    value={silencePadding}
                    onChange={(e) => setSilencePadding(Number(e.target.value))}
                  >
                    <option value={0.04}>0.04s (Corte seco)</option>
                    <option value={0.08}>0.08s (Natural)</option>
                    <option value={0.15}>0.15s (Suave)</option>
                  </select>
                </label>
              </div>
            </div>

            {/* List of preview silences */}
            <div className="max-h-36 overflow-y-auto space-y-1 rounded-[6px] border border-white/5 bg-[#090A0D] p-2 text-[10px] font-mono scrollbar-thin scrollbar-thumb-zinc-700">
              {detectedSilences.length === 0 ? (
                <p className="text-center text-zinc-500 py-3 italic">Nenhuma pausa detectada com os parâmetros atuais.</p>
              ) : (
                detectedSilences.map((silence, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded px-2 py-1 bg-white/[0.02] hover:bg-white/[0.05]"
                  >
                    <span className="text-zinc-300">Pausa {idx + 1}</span>
                    <span className="text-zinc-400">
                      {clock(silence.start)} &rarr; {clock(silence.end)}
                    </span>
                    <span className="text-emerald-400 font-bold">
                      {(silence.end - silence.start).toFixed(2)}s
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowSilenceModal(false)}
                className="rounded-[6px] border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={detectedSilences.length === 0}
                onClick={() => applyAutoCutSilences(detectedSilences)}
                className="flex items-center gap-1.5 rounded-[6px] bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-40"
              >
                <Check size={14} />
                Aplicar Auto-Corte ({detectedSilences.length} trechos)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Bottom Workstation Footer (Stitch Footer) */}
      <footer className="fixed inset-x-0 bottom-0 z-50 flex min-h-[58px] items-center justify-between border-t border-white/[0.08] bg-[#101217]/95 px-4 py-2 shadow-[0_-12px_32px_rgba(0,0,0,0.32)] backdrop-blur-xl">
        <div className="flex flex-col">
          <span className="flex items-center gap-2 text-[11px] font-medium text-[#D5D8E0]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Projeto pronto · Kaoz.1 v{applicationVersion}</span>
          {analysis?.artifacts.previewPath ? (
            <span className="text-[10px] font-mono text-emerald-400 truncate max-w-md">
              Prévia: {analysis.artifacts.previewPath}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500">Pronto para processamento e aprovação</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            disabled={!!busy || !analysis}
            onClick={renderPreview}
            className="flex items-center gap-2 rounded-[6px] bg-[#242832] px-3 py-2 text-xs font-medium text-[#D5D8E0] transition-colors hover:bg-[#303541] disabled:opacity-40"
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
            className="kaoz-signal-action flex items-center gap-2 bg-[#7C6CF2] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#8B7CF6] disabled:opacity-40"
          >
            <CheckCircle size={15} />
            Preparar para o DaVinci (opcional)
          </button>
        </div>
      </footer>
    </div>
  );
}
