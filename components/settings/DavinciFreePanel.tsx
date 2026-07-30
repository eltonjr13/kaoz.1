"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Volume2,
  Maximize2,
  Scissors,
  Copy,
  ZoomIn,
  ZoomOut,
  Folder,
  Palette,
  Subtitles,
  Video,
} from "lucide-react";

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
    | "transition";
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
  captions: Array<{ index: number; enabled?: boolean; start?: number; end?: number; text?: string }>;
};

type Analysis = {
  id: string;
  courseName?: string;
  moduleName: string;
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
  status: "queued" | "running" | "completed" | "completed-with-errors";
  folderPath: string;
  courseName: string;
  total: number;
  completed: number;
  failed: number;
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
    status: "pending" | "analyzing" | "rendering" | "completed" | "failed";
    previewPath?: string;
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
};

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function DavinciFreePanel({ onStatusMessage }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [review, setReview] = useState<EditorialReview>({ events: [], captions: [] });
  const [batchFolder, setBatchFolder] = useState("");
  const [batchDiscovery, setBatchDiscovery] = useState<BatchDiscovery | null>(null);
  const [batch, setBatch] = useState<BatchJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<"single" | "batch">("single");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [form, setForm] = useState({
    sourcePath: "",
    courseName: "",
    moduleName: "Módulo 1 — Boas-vindas",
    style: "balanced",
    captionsEnabled: true,
    reuseCourseTheme: true,
    musicPath: "",
    musicDb: "-38",
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
      setBatchFolder(restored.folderPath);
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
    const result = await action("analyze", {
      requestId: `analysis-${crypto.randomUUID()}`,
      sourcePath: form.sourcePath,
      courseName: form.courseName,
      moduleName: form.moduleName,
      style: form.style,
      captionsEnabled: form.captionsEnabled,
      reuseCourseTheme: form.reuseCourseTheme,
      musicPath: form.musicPath,
      musicDb: Number(form.musicDb),
      useAgent: true,
    });
    if (result?.id) {
      setAnalysis(result as Analysis);
      setReview({ events: [], captions: [] });
      onStatusMessage({
        text: "Áudio transcrito e decisões de edição preparadas para revisão.",
        type: "success",
      });
    }
  }

  async function renderPreview() {
    if (!analysis) return;
    const saved = await action("save-editorial-review", { planId: analysis.id, review });
    if (!saved) return;
    const result = await action("render-preview", { planId: analysis.id });
    if (result?.plan) {
      setAnalysis((current) => current ? {
        ...current,
        artifacts: (result.plan as Analysis).artifacts,
      } : result.plan as Analysis);
      onStatusMessage({
        text: `Prévia renderizada em ${String(result.previewPath)}`,
        type: "success",
      });
    }
  }

  function eventReview(event: EditEvent) {
    return review.events.find((item) => item.id === event.id) || { id: event.id };
  }

  function updateEvent(event: EditEvent, patch: Partial<EditEvent> & { enabled?: boolean }) {
    setReview((current) => ({
      ...current,
      events: [...current.events.filter((item) => item.id !== event.id), { ...eventReview(event), ...patch, id: event.id }],
    }));
  }

  function captionReview(index: number) {
    return review.captions.find((item) => item.index === index) || { index };
  }

  function updateCaption(index: number, patch: Partial<EditorialReview["captions"][number]>) {
    setReview((current) => ({
      ...current,
      captions: [...current.captions.filter((item) => item.index !== index), { ...captionReview(index), ...patch, index }],
    }));
  }

  async function restoreAutomatic() {
    if (!analysis) return;
    const result = await action("reset-editorial-review", { planId: analysis.id });
    if (result) {
      setReview({ events: [], captions: [] });
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
      setForm((current) => ({
        ...current,
        courseName: discovery.suggestedCourseName,
      }));
      onStatusMessage({
        text: `${String(result.total)} aulas encontradas. Iniciando o processamento automático.`,
        type: "info",
      });
      await startBatch(folderPath, discovery.suggestedCourseName);
    }
  }

  async function startBatch(folderPath = batchFolder, courseName = form.courseName) {
    const result = await action("start-batch", {
      requestId: `course-batch-${crypto.randomUUID()}`,
      folderPath,
      courseName,
      style: form.style,
      captionsEnabled: form.captionsEnabled,
      musicPath: form.musicPath,
      musicDb: Number(form.musicDb),
      useAgent: true,
    });
    if (result?.id) {
      setBatch(result as BatchJob);
      onStatusMessage({
        text: "Lote iniciado. O processamento continuará em segundo plano, uma aula por vez.",
        type: "success",
      });
    }
  }

  async function retryBatch() {
    if (!batch) return;
    const result = await action("retry-batch", { batchId: batch.id });
    if (result?.id) setBatch(result as BatchJob);
  }

  const eventCounts = useMemo(() => {
    const counts: Partial<Record<EditEvent["kind"], number>> = {};
    for (const event of analysis?.events || []) {
      counts[event.kind] = (counts[event.kind] || 0) + 1;
    }
    return counts;
  }, [analysis]);

  const update =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

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
        <div className="grid gap-4 lg:grid-cols-12 min-h-[640px]">
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
                  <input
                    className={fieldClass}
                    placeholder="C:\Videos\aula.mp4"
                    value={form.sourcePath}
                    onChange={update("sourcePath")}
                  />
                </label>

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
                  </select>
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
                    Volume dB
                    <input className={fieldClass} value={form.musicDb} onChange={update("musicDb")} />
                  </label>
                </div>
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
          <main className="lg:col-span-6 flex flex-col rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden shadow-2xl relative">
            {/* Player Container */}
            <div className="flex-1 p-4 flex flex-col justify-center items-center relative min-h-[340px] bg-black">
              <div className="absolute inset-0 bg-[radial-gradient(#353434_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

              <div className="w-full max-w-2xl aspect-video bg-zinc-900 rounded-xl overflow-hidden relative shadow-2xl border border-white/10 flex flex-col justify-center items-center group">
                {analysis?.artifacts.previewPath ? (
                  <div className="w-full h-full flex flex-col justify-center items-center bg-zinc-950 p-4 text-center">
                    <Film size={40} className="text-emerald-400 mb-2 animate-bounce" />
                    <p className="text-xs font-bold text-white">Prévia Renderizada Pronta</p>
                    <p className="text-[11px] font-mono text-emerald-400 mt-1 break-all px-4">
                      {analysis.artifacts.previewPath}
                    </p>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col justify-center items-center bg-zinc-900/90 text-center p-6">
                    <Video size={48} className="text-zinc-600 mb-3" />
                    <p className="text-xs font-bold text-zinc-300">Estúdio de Prévia Interativa</p>
                    <p className="text-[11px] text-zinc-500 max-w-md mt-1">
                      Envie o vídeo da aula ou clique em Analisar para visualizar o enquadramento do apresentador e a linha de edição.
                    </p>
                  </div>
                )}

                {/* AI Subject Tracking Overlay */}
                <div className="absolute top-6 left-8 w-28 h-36 border border-emerald-400/60 rounded-md pointer-events-none opacity-80 shadow-[0_0_15px_rgba(78,222,163,0.2)_inset]">
                  <span className="absolute -top-4 left-0 text-[9px] text-emerald-300 font-mono bg-zinc-900/90 px-1.5 py-0.5 rounded border border-emerald-500/40">
                    {analysis?.visual.source === "agent-contact-sheet"
                      ? "Apresentador identificado"
                      : "Subj. Detected"}
                  </span>
                </div>

                {/* Controls Overlay */}
                <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col gap-1.5 opacity-90 transition-opacity">
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden cursor-pointer">
                    <div className="h-full bg-emerald-400 w-[20%] relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_8px_rgba(78,222,163,0.8)]" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-xs text-zinc-300 px-1">
                    <div className="flex items-center gap-2">
                      <button className="hover:text-emerald-400 transition-colors">
                        <Play size={14} className="fill-current" />
                      </button>
                      <span className="font-mono text-[11px] text-zinc-400">00:04:12 / 00:28:45</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Volume2 size={14} className="hover:text-white transition-colors cursor-pointer" />
                      <Maximize2 size={14} className="hover:text-white transition-colors cursor-pointer" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Multi-Track Timeline (Stitch Timeline) */}
            <div className="h-56 bg-zinc-900/90 border-t border-white/10 flex flex-col shrink-0">
              {/* Timeline Header Toolbar */}
              <div className="h-9 border-b border-white/10 flex items-center px-4 justify-between bg-zinc-950 text-zinc-400">
                <div className="flex items-center gap-2 text-xs">
                  <button className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors" title="Cut">
                    <Scissors size={14} />
                  </button>
                  <button className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors" title="Copy">
                    <Copy size={14} />
                  </button>
                  <div className="w-px h-3.5 bg-white/10 mx-1" />
                  <button className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors" title="Zoom In">
                    <ZoomIn size={14} />
                  </button>
                  <button className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors" title="Zoom Out">
                    <ZoomOut size={14} />
                  </button>
                </div>
                <div className="flex-1 flex justify-between px-6 text-[10px] font-mono text-zinc-500 select-none">
                  <span>0:00</span>
                  <span>0:05</span>
                  <span>0:10</span>
                  <span>0:15</span>
                  <span>0:20</span>
                  <span>0:25</span>
                  <span>0:30</span>
                </div>
              </div>

              {/* Tracks Area */}
              <div className="flex-1 overflow-x-auto p-3 flex flex-col gap-2 relative bg-[linear-gradient(to_right,#18181b_1px,transparent_1px)] [background-size:40px_100%]">
                {/* Playhead */}
                <div className="absolute top-0 bottom-0 left-[20%] w-px bg-red-500 z-20 pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.8)]">
                  <div className="absolute -top-1 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-red-500 rounded-xs" />
                </div>

                {/* Track V1 (Video) */}
                <div className="h-10 bg-zinc-950/80 rounded-lg border border-white/10 flex relative items-center px-2">
                  <span className="text-[10px] font-mono font-bold text-zinc-500 w-8 shrink-0">V1</span>
                  <div className="flex-1 relative h-full flex items-center">
                    <div className="absolute left-0 w-[12%] h-7 bg-zinc-800 border border-white/20 rounded px-2 flex items-center text-[10px] text-zinc-300 font-mono truncate">
                      Intro Sequence
                    </div>
                    <div className="absolute left-[13%] w-[45%] h-7 bg-emerald-950/60 border border-emerald-500 rounded px-2 flex items-center text-[10px] text-emerald-300 font-mono truncate font-bold shadow-[0_0_10px_rgba(16,185,129,0.15)_inset]">
                      A-Roll (Ativo)
                    </div>
                    <div className="absolute left-[59%] w-[20%] h-7 bg-zinc-800 border border-white/20 rounded px-2 flex items-center text-[10px] text-zinc-300 font-mono truncate">
                      B-Roll Cut
                    </div>
                  </div>
                </div>

                {/* Track FX (AI Effects) */}
                <div className="h-8 bg-zinc-950/60 rounded-lg border border-white/10 flex relative items-center px-2">
                  <span className="text-[10px] font-mono font-bold text-violet-400 w-8 shrink-0">FX</span>
                  <div className="flex-1 relative h-full flex items-center gap-2">
                    {analysis?.events.length ? (
                      analysis.events.slice(0, 6).map((evt, idx) => (
                        <div
                          key={evt.id || idx}
                          onClick={() => setSelectedEventId(evt.id)}
                          className={`h-5 px-2 rounded text-[9px] font-mono font-semibold border flex items-center cursor-pointer transition-all ${
                            selectedEventId === evt.id
                              ? "bg-emerald-500 text-black border-white shadow-md shadow-emerald-500/30"
                              : "bg-violet-950/80 border-violet-500/40 text-violet-300 hover:border-violet-400"
                          }`}
                        >
                          {kindLabel[evt.kind]}: {clock(evt.start)}
                        </div>
                      ))
                    ) : (
                      <>
                        <div className="h-5 px-2 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 rounded text-[9px] font-mono flex items-center">
                          L.Third (0:00)
                        </div>
                        <div className="h-5 px-2 bg-violet-950/80 border border-violet-500/40 text-violet-300 rounded text-[9px] font-mono flex items-center">
                          Zoom (0:04)
                        </div>
                        <div className="h-5 px-2 bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 rounded text-[9px] font-mono flex items-center">
                          Impact (0:06)
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Track A1 (Audio Waveform) */}
                <div className="h-8 bg-zinc-950/80 rounded-lg border border-white/10 flex relative items-center px-2">
                  <span className="text-[10px] font-mono font-bold text-zinc-500 w-8 shrink-0">A1</span>
                  <div className="flex-1 h-full flex items-center gap-[2px] opacity-50 px-2 overflow-hidden">
                    {Array.from({ length: 48 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-emerald-400 rounded-full"
                        style={{ height: `${(i % 5 + 1) * 18}%` }}
                      />
                    ))}
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
                  return (
                    <div
                      key={`edit-${event.id}`}
                      className={`rounded-xl border p-2.5 transition-all text-xs ${
                        enabled ? "border-white/10 bg-black/40" : "border-white/5 opacity-40"
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
                        <span className="text-[10px] text-zinc-400 truncate">{event.reason}</span>
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
                    onChange={(input) => setReview((current) => ({ ...current, captionsEnabled: input.target.checked }))}
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

          <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Pasta selecionada</p>
            <div className="flex items-center justify-between gap-3">
              <p className="truncate font-mono text-xs text-zinc-200">
                {batchFolder || "Clique no botão para escolher a pasta no Explorador do Windows."}
              </p>
            </div>
            <div className="pt-2">
              <button
                disabled={!!busy || ["queued", "running"].includes(batch?.status || "")}
                onClick={discoverBatch}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-600/20 transition-all hover:brightness-110 disabled:opacity-40"
              >
                {busy === "discover-batch" || busy === "choose-folder" || busy === "start-batch" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <FolderSearch size={15} />
                )}
                Selecionar pasta e processar
              </button>
            </div>
          </div>

          {batchDiscovery && (
            <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
              <p className="text-xs font-semibold text-emerald-300">
                {batchDiscovery.total} aulas encontradas e enviadas para a fila.
              </p>
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs">
                {batchDiscovery.videos.map((video) => (
                  <div key={video.sourcePath} className="flex items-center gap-3 text-[11px]">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-300 font-mono text-[10px]">
                      {video.index}
                    </span>
                    <span className="font-medium text-zinc-200">{video.moduleName}</span>
                    <span className="truncate text-zinc-500 font-mono">{video.relativePath}</span>
                  </div>
                ))}
              </div>
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
                </div>
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
                      <span className="font-semibold text-zinc-200 truncate">{item.index}. {item.moduleName}</span>
                      <span className="text-emerald-300 font-bold uppercase text-[10px]">{item.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
          <span className="text-[11px] font-bold text-zinc-300">AIVideoPro v2.4.0</span>
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
            {analysis?.artifacts.previewPath ? "Renderizar novamente" : "Renderizar prévia"}
          </button>

          <button
            disabled={!!busy || !analysis?.artifacts.previewPath || !!status?.pendingPlan}
            onClick={approve}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-5 py-2 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 hover:brightness-110 disabled:opacity-40 transition-all"
          >
            <CheckCircle size={15} />
            Aprovar e preparar para o Resolve
          </button>
        </div>
      </footer>
    </div>
  );
}
