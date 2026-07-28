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
  reason: string;
};

type Analysis = {
  id: string;
  moduleName: string;
  transcript: Array<{ start: number; end: number; text: string }>;
  captions: Array<{ start: number; end: number; text: string }>;
  events: EditEvent[];
  cursorAnalysis: { status: string; message: string };
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
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500/50";

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
  const [batchFolder, setBatchFolder] = useState("");
  const [batchDiscovery, setBatchDiscovery] = useState<BatchDiscovery | null>(null);
  const [batch, setBatch] = useState<BatchJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
    if (data?.id) setBatch(data as BatchJob);
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
      onStatusMessage({
        text: "Áudio transcrito e decisões de edição preparadas para revisão.",
        type: "success",
      });
    }
  }

  async function renderPreview() {
    if (!analysis) return;
    const result = await action("render-preview", { planId: analysis.id });
    if (result?.plan) {
      setAnalysis(result.plan as Analysis);
      onStatusMessage({
        text: `Prévia renderizada em ${String(result.previewPath)}`,
        type: "success",
      });
    }
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
    let folderPath = batchFolder;
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
    if (!folderPath) {
      onStatusMessage({
        text: "Selecione ou informe a pasta do curso.",
        type: "error",
      });
      return;
    }
    const result = await action("discover-batch", { folderPath });
    if (result?.videos) {
      setBatchDiscovery(result as BatchDiscovery);
      onStatusMessage({
        text: `${String(result.total)} aulas encontradas e ordenadas.`,
        type: "success",
      });
    }
  }

  async function startBatch() {
    const result = await action("start-batch", {
      requestId: `course-batch-${crypto.randomUUID()}`,
      folderPath: batchFolder,
      courseName: form.courseName,
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
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Sparkles size={17} className="text-emerald-400" />
              Editor inteligente para DaVinci Resolve Free
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-400">
              O Kaoz analisa o áudio localmente, entende os momentos importantes,
              renderiza uma prévia completa e só envia ao Resolve depois da sua aprovação.
            </p>
          </div>
          <button
            onClick={() => refresh()}
            className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:text-white"
            title="Atualizar"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span className={status?.runnerInstalled ? "text-emerald-400" : "text-amber-400"}>
            {status?.runnerInstalled ? "● Runner instalado" : "● Runner ainda não instalado"}
          </span>
          {status?.pendingPlan && (
            <span className="text-cyan-300">
              Plano pendente: {status.pendingPlan.timelineName}
            </span>
          )}
        </div>
        {!status?.runnerInstalled && (
          <button
            disabled={!!busy}
            onClick={() =>
              action("install", { requestId: `install-${crypto.randomUUID()}` })
            }
            className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-50"
          >
            {busy === "install" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            Instalar runner no Resolve
          </button>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <ListVideo size={16} className="text-violet-300" />
            Editar curso inteiro em lote
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-400">
            Localiza aulas em pastas e subpastas, ordena os nomes naturalmente e gera
            uma prévia por vídeo com a mesma identidade do curso. Nenhuma aula é enviada
            automaticamente ao Resolve.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="space-y-1 text-xs text-zinc-400">
            Pasta raiz do curso
            <input
              className={fieldClass}
              placeholder="C:\Cursos\Meu curso"
              value={batchFolder}
              onChange={(event) => {
                setBatchFolder(event.target.value);
                setBatchDiscovery(null);
              }}
            />
          </label>
          <div className="flex items-end">
            <button
              disabled={!!busy}
              onClick={discoverBatch}
              className="flex items-center gap-2 rounded-lg border border-violet-400/30 px-4 py-2 text-xs font-semibold text-violet-200 disabled:opacity-40"
            >
              {busy === "discover-batch" || busy === "choose-folder" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FolderSearch size={14} />
              )}
              Localizar aulas
            </button>
          </div>
        </div>

        {batchDiscovery && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-emerald-300">
                {batchDiscovery.total} aulas encontradas na ordem abaixo.
              </p>
              <button
                disabled={!!busy || !form.courseName}
                onClick={startBatch}
                className="flex items-center gap-2 rounded-lg bg-violet-400 px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
              >
                {busy === "start-batch" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                Processar curso inteiro
              </button>
            </div>
            {!form.courseName && (
              <p className="text-[11px] text-amber-300">
                Preencha o nome do curso abaixo para criar a identidade compartilhada.
              </p>
            )}
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3">
              {batchDiscovery.videos.map((video) => (
                <div key={video.sourcePath} className="flex gap-3 text-[11px]">
                  <span className="w-7 shrink-0 text-right text-violet-300">
                    {video.index}.
                  </span>
                  <span className="text-zinc-300">{video.moduleName}</span>
                  <span className="truncate text-zinc-600">{video.relativePath}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {batch && (
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-zinc-100">
                  {batch.courseName} · {batch.completed}/{batch.total} concluídas
                </p>
                <p className="text-[11px] text-zinc-500">
                  Estado: {batch.status}
                  {batch.failed > 0 ? ` · ${batch.failed} com falha` : ""}
                </p>
              </div>
              {batch.failed > 0 && !["queued", "running"].includes(batch.status) && (
                <button
                  disabled={!!busy}
                  onClick={retryBatch}
                  className="flex items-center gap-2 rounded-lg border border-amber-400/30 px-3 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40"
                >
                  <RotateCcw size={13} />
                  Repetir falhas
                </button>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all"
                style={{
                  width: `${batch.total ? Math.round(((batch.completed + batch.failed) / batch.total) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {batch.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-zinc-300">
                      {item.index}. {item.moduleName}
                    </span>
                    <span
                      className={
                        item.status === "completed"
                          ? "text-emerald-300"
                          : item.status === "failed"
                            ? "text-red-300"
                            : item.status === "analyzing" || item.status === "rendering"
                              ? "text-violet-300"
                              : "text-zinc-500"
                      }
                    >
                      {item.status}
                    </span>
                  </div>
                  {item.previewPath && (
                    <p className="mt-1 break-all text-emerald-500">{item.previewPath}</p>
                  )}
                  {item.error && (
                    <p className="mt-1 text-red-300">{item.error}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5 md:grid-cols-2">
        <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">
          Vídeo da aula
          <input
            className={fieldClass}
            placeholder="C:\Videos\aula.mp4"
            value={form.sourcePath}
            onChange={update("sourcePath")}
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Nome do curso (identidade compartilhada)
          <input className={fieldClass} value={form.courseName} onChange={update("courseName")} />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Nome do módulo
          <input className={fieldClass} value={form.moduleName} onChange={update("moduleName")} />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Estilo
          <select className={fieldClass} value={form.style} onChange={update("style")}>
            <option value="subtle">Discreto</option>
            <option value="balanced">Equilibrado</option>
            <option value="dynamic">Dinâmico</option>
          </select>
        </label>
        <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={form.reuseCourseTheme}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                reuseCourseTheme: event.target.checked,
              }))
            }
            className="h-4 w-4 accent-emerald-500"
          />
          <span>
            <strong className="block text-zinc-100">Manter identidade do curso</strong>
            <span className="text-[11px] text-zinc-500">
              Cria o tema no primeiro vídeo e reutiliza nas próximas aulas.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 md:col-span-2">
          <input
            type="checkbox"
            checked={form.captionsEnabled}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                captionsEnabled: event.target.checked,
              }))
            }
            className="h-4 w-4 accent-emerald-500"
          />
          <span>
            <strong className="block text-zinc-100">Incluir legendas no vídeo</strong>
            <span className="text-[11px] text-zinc-500">
              A transcrição continua sendo analisada mesmo quando as legendas estão desativadas.
            </span>
          </span>
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Música ambiente opcional
          <input className={fieldClass} value={form.musicPath} onChange={update("musicPath")} />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Volume da música
          <input className={fieldClass} value={form.musicDb} onChange={update("musicDb")} />
        </label>
        <div className="flex items-end">
          <button
            disabled={!!busy || !form.sourcePath || !form.courseName || !form.moduleName}
            onClick={analyze}
            className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
          >
            {busy === "analyze" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <WandSparkles size={14} />
            )}
            Analisar áudio e planejar edição
          </button>
        </div>
      </div>

      {analysis && (
        <div className="space-y-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-5">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">Revisão da análise</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Decisões: {analysis.semantic.source === "agent" ? "agente semântico" : "fallback local"}
              {analysis.semantic.model ? ` · ${analysis.semantic.model}` : ""}
            </p>
            {analysis.courseTheme && (
              <p className="mt-2 max-w-3xl text-xs leading-relaxed text-emerald-300">
                Identidade {analysis.courseTheme.reused ? "reutilizada" : "criada"}:{" "}
                <strong>{analysis.courseTheme.label}</strong> · {analysis.courseTheme.tone}.
                <span className="block text-zinc-500">{analysis.courseTheme.rationale}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {Object.entries(eventCounts).map(([kind, count]) => (
              <span
                key={kind}
                className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300"
              >
                {kindLabel[kind as EditEvent["kind"]]}: {count}
              </span>
            ))}
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
              Legendas: {analysis.design?.captionsEnabled === false ? "desativadas" : analysis.captions.length}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
              Tema: {analysis.courseTheme?.label || "automático"}
            </span>
          </div>

          <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3">
            {analysis.events.map((event) => (
              <div key={event.id} className="text-xs">
                <span className="font-semibold text-cyan-300">
                  {clock(event.start)} · {kindLabel[event.kind]}
                </span>
                <span className="ml-2 text-zinc-300">{event.label}</span>
                <p className="text-[11px] text-zinc-500">{event.reason}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-amber-300">{analysis.cursorAnalysis.message}</p>

          <div className="flex flex-wrap gap-3">
            <button
              disabled={!!busy}
              onClick={renderPreview}
              className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
            >
              {busy === "render-preview" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Film size={14} />
              )}
              {analysis.artifacts.previewPath ? "Renderizar novamente" : "Renderizar prévia"}
            </button>
            {analysis.artifacts.previewPath && (
              <button
                disabled={!!busy || !!status?.pendingPlan}
                onClick={approve}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
              >
                <CheckCircle size={14} />
                Aprovar e preparar para o Resolve
              </button>
            )}
          </div>

          {analysis.artifacts.previewPath && (
            <p className="break-all text-[11px] text-emerald-400">
              Prévia: {analysis.artifacts.previewPath}
            </p>
          )}
        </div>
      )}

      {status?.pendingPlan && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-5">
          <p className="text-xs text-amber-200">
            Há um plano anterior aguardando aplicação. Você pode aplicá-lo no Resolve ou
            arquivá-lo para aprovar a nova prévia.
          </p>
          <button
            disabled={!!busy}
            onClick={archivePending}
            className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40"
          >
            <Archive size={14} />
            Arquivar plano anterior
          </button>
        </div>
      )}

      {status?.pendingPlan && analysis?.artifacts.previewPath && (
        <p className="text-xs text-cyan-300">
          Depois da aprovação, abra o Resolve e execute Workspace &gt; Scripts &gt;
          Utility &gt; Kaoz.1 &gt; Kaoz1ApplyPlan.
        </p>
      )}
    </div>
  );
}
