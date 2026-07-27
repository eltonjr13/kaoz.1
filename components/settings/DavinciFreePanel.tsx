"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  CheckCircle,
  Download,
  Film,
  Loader2,
  RefreshCw,
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
  kind: "intro" | "outro" | "lower-third" | "zoom" | "cursor" | "transition";
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
  artifacts: { previewPath?: string; captionsPath: string; planPath: string };
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
  zoom: "Zoom",
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
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    sourcePath: "",
    courseName: "",
    moduleName: "Módulo 1 — Boas-vindas",
    style: "balanced",
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
          Nome do curso
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
            disabled={!!busy || !form.sourcePath || !form.moduleName}
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
              Legendas: {analysis.captions.length}
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
