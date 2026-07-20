"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Download, Loader2, RefreshCw, RotateCw } from "lucide-react";

type UpdateStatus = MrChickenUpdateStatus;

const INITIAL_STATUS: UpdateStatus = { state: "idle" };

function messageFor(status: UpdateStatus) {
  switch (status.state) {
    case "checking": return "Verificando se existe uma nova versão...";
    case "available": return `A versão ${status.version || "mais recente"} está disponível.`;
    case "downloading": return `Baixando atualização${typeof status.progress === "number" ? `: ${status.progress}%` : "..."}`;
    case "downloaded": return `A versão ${status.version || "nova"} está pronta para instalar.`;
    case "not-available": return "Você já está usando a versão mais recente.";
    case "unsupported": return status.error || "Abra o MrChicken instalado no Windows para verificar atualizações.";
    case "error": return status.error || "Não foi possível verificar a atualização agora.";
    default: return "Verifique novas versões sem reinstalar o aplicativo.";
  }
}

export function AppUpdatesPanel() {
  const [status, setStatus] = useState<UpdateStatus>(INITIAL_STATUS);
  const bridge = typeof window === "undefined" ? undefined : window.mrChickenDesktop;

  useEffect(() => {
    if (!bridge) return;
    void bridge.getUpdateStatus().then(setStatus);
    return bridge.onUpdateStatus(setStatus);
  }, [bridge]);

  const check = async () => {
    if (!bridge) return;
    setStatus((current) => ({ ...current, state: "checking", error: undefined }));
    setStatus(await bridge.checkForUpdates());
  };

  const download = async () => {
    if (!bridge) return;
    setStatus((current) => ({ ...current, state: "downloading", progress: 0, error: undefined }));
    setStatus(await bridge.downloadUpdate());
  };

  const install = async () => {
    if (!bridge) return;
    await bridge.installUpdate();
  };

  const busy = status.state === "checking" || status.state === "downloading";
  const hasError = status.state === "error";
  const canCheck = Boolean(bridge) && !busy;

  return (
    <section className="rounded-[16px] border border-white/5 bg-[#111114] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <Download size={18} />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-200">Atualizações do aplicativo</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-500">
              {messageFor(status)}
            </p>
            {status.currentVersion && <p className="mt-2 text-[10px] font-medium text-zinc-600">Versão instalada: {status.currentVersion}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status.state === "available" && (
            <button type="button" onClick={() => void download()} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-4 py-2 text-[10px] font-bold text-black transition hover:bg-emerald-300">
              <Download size={12} /> Baixar atualização
            </button>
          )}
          {status.state === "downloaded" && (
            <button type="button" onClick={() => void install()} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-4 py-2 text-[10px] font-bold text-black transition hover:bg-emerald-300">
              <RotateCw size={12} /> Reiniciar e atualizar
            </button>
          )}
          {status.state !== "available" && status.state !== "downloaded" && (
            <button type="button" onClick={() => void check()} disabled={!canCheck} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[10px] font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Verificar atualização
            </button>
          )}
        </div>
      </div>

      {(status.state === "not-available" || status.state === "downloaded" || hasError) && (
        <div className={`mt-5 flex items-center gap-2 border-t border-white/[0.05] pt-4 text-[10px] ${hasError ? "text-rose-400" : "text-emerald-400"}`}>
          {hasError ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
          <span>{hasError ? "Tente novamente quando a conexão estiver disponível." : status.state === "downloaded" ? "A instalação acontecerá após reiniciar o MrChicken." : "Nenhuma ação é necessária."}</span>
        </div>
      )}
      {!bridge && <p className="mt-5 border-t border-white/[0.05] pt-4 text-[10px] text-zinc-600">Este controle funciona no aplicativo MrChicken para Windows.</p>}
    </section>
  );
}
