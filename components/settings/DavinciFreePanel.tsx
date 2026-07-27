"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Download, Film, Loader2, RefreshCw, WandSparkles } from "lucide-react";

type Status = {
  runnerInstalled: boolean;
  runnerDirectory: string;
  pendingPlan: null | { requestId: string; timelineName: string; createdAt: string };
  latestResult: null | Record<string, unknown>;
  instructions: string[];
};

type Props = {
  onStatusMessage: (message: { text: string; type: "success" | "error" | "info" }) => void;
};

const fieldClass = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500/50";

export function DavinciFreePanel({ onStatusMessage }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    timelineName: "Módulo 1",
    mainPath: "",
    introPath: "",
    outroPath: "",
    voicePath: "",
    processedVoicePath: "",
    musicPath: "",
    reviewedSrtPath: "",
    fps: "30",
    musicDb: "-38",
  });

  const refresh = useCallback(async () => {
    const response = await fetch("/api/davinci-free", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao consultar o Resolve Free.");
    setStatus(data);
  }, []);

  useEffect(() => {
    refresh().catch((error) => onStatusMessage({ text: String(error), type: "error" }));
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
      onStatusMessage({
        text: name === "install" ? "Runner do Resolve Free instalado." : "Preparação concluída.",
        type: "success",
      });
      return data;
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function prepareVoice() {
    const result = await action("prepare-voice", {
      requestId: `voice-${crypto.randomUUID()}`,
      inputPath: form.voicePath,
    });
    if (result?.outputPath) {
      setForm((current) => ({ ...current, processedVoicePath: String(result.outputPath) }));
    }
  }

  async function preparePlan() {
    await action("prepare-plan", {
      requestId: `edit-${crypto.randomUUID()}`,
      timelineName: form.timelineName,
      mainPath: form.mainPath,
      introPath: form.introPath,
      outroPath: form.outroPath,
      processedVoicePath: form.processedVoicePath,
      musicPath: form.musicPath,
      reviewedSrtPath: form.reviewedSrtPath,
      fps: Number(form.fps),
      musicDb: Number(form.musicDb),
      colorCorrection: true,
      markers: [
        { seconds: 0, kind: "lower-third", name: `LOWER THIRD — ${form.timelineName}`, durationSeconds: 4 },
        { seconds: 1, kind: "transition", name: "TRANSIÇÃO DISCRETA DA INTRO", durationSeconds: 0.5 },
        { seconds: 5, kind: "review", name: "REVISAR COR, VOZ E SINCRONIA", durationSeconds: 1 },
      ],
    });
  }

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Film size={17} className="text-emerald-400" />DaVinci Resolve Free
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-400">
              O Kaoz prepara arquivos e um plano de uso único; você o aplica pelo menu interno do Resolve. Sempre é criada uma timeline nova.
            </p>
          </div>
          <button onClick={() => refresh()} className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:text-white" title="Atualizar">
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span className={status?.runnerInstalled ? "text-emerald-400" : "text-amber-400"}>
            {status?.runnerInstalled ? "● Runner instalado" : "● Runner ainda não instalado"}
          </span>
          {status?.pendingPlan && <span className="text-cyan-300">Plano pendente: {status.pendingPlan.timelineName}</span>}
        </div>
        {!status?.runnerInstalled && (
          <button
            disabled={!!busy}
            onClick={() => action("install", { requestId: `install-${crypto.randomUUID()}` })}
            className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-50"
          >
            {busy === "install" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Instalar runner no Resolve
          </button>
        )}
      </div>

      <div className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5 md:grid-cols-2">
        <label className="space-y-1 text-xs text-zinc-400">Nome do módulo<input className={fieldClass} value={form.timelineName} onChange={update("timelineName")} /></label>
        <label className="space-y-1 text-xs text-zinc-400">FPS<input className={fieldClass} value={form.fps} onChange={update("fps")} /></label>
        <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">Vídeo principal — obrigatório<input className={fieldClass} placeholder="D:\Videos\aula.mp4" value={form.mainPath} onChange={update("mainPath")} /></label>
        <label className="space-y-1 text-xs text-zinc-400">Intro de 3–5 s<input className={fieldClass} value={form.introPath} onChange={update("introPath")} /></label>
        <label className="space-y-1 text-xs text-zinc-400">Vinheta de encerramento<input className={fieldClass} value={form.outroPath} onChange={update("outroPath")} /></label>
        <label className="space-y-1 text-xs text-zinc-400">Música ambiente<input className={fieldClass} value={form.musicPath} onChange={update("musicPath")} /></label>
        <label className="space-y-1 text-xs text-zinc-400">Volume da música (-35 a -40 dB)<input className={fieldClass} value={form.musicDb} onChange={update("musicDb")} /></label>
        <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">Legenda SRT revisada<input className={fieldClass} value={form.reviewedSrtPath} onChange={update("reviewedSrtPath")} /></label>
        <div className="space-y-2 md:col-span-2">
          <label className="space-y-1 text-xs text-zinc-400">Voz original para limpar<input className={fieldClass} value={form.voicePath} onChange={update("voicePath")} /></label>
          <button disabled={!!busy || !form.voicePath} onClick={prepareVoice} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200 disabled:opacity-40">
            <WandSparkles size={14} />Aplicar redução de ruído + EQ + compressão
          </button>
          {form.processedVoicePath && <p className="text-[11px] text-emerald-400">Voz preparada: {form.processedVoicePath}</p>}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-300">Cobertura do fluxo</h3>
        <div className="mt-3 grid gap-2 text-xs text-zinc-400 md:grid-cols-2">
          {[
            "Intro e encerramento na timeline",
            "Correção de cor conservadora",
            "Voz limpa, equalizada e comprimida",
            "Música em faixa separada a -35…-40 dB",
            "Lower third do módulo marcado",
            "Zoom, cursor e transições marcados",
            "SRT revisado indicado para importação",
            "Timeline nova e rastreável",
          ].map((item) => <span key={item} className="flex items-center gap-2"><CheckCircle size={13} className="text-emerald-500" />{item}</span>)}
        </div>
        <button
          disabled={!!busy || !status?.runnerInstalled || !form.mainPath || !!status?.pendingPlan}
          onClick={preparePlan}
          className="mt-5 flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
        >
          {busy === "prepare-plan" ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
          Preparar plano de edição
        </button>
        {status?.pendingPlan && (
          <p className="mt-3 text-xs text-cyan-300">
            Agora abra o Resolve e execute Workspace &gt; Scripts &gt; Utility &gt; Kaoz.1 &gt; Kaoz1ApplyPlan.
          </p>
        )}
      </div>
    </div>
  );
}
