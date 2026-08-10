"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Info, Sparkles, Video, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DavinciFreePanel } from "@/components/settings/DavinciFreePanel";

type StatusMessage = { text: string; type: "success" | "error" | "info" };

const statusVariants: Record<
  StatusMessage["type"],
  { dialogClass: string; iconClass: string; icon: LucideIcon; label: string; role: "alertdialog" | "dialog" }
> = {
  error: {
    dialogClass: "border-red-500/30 bg-[#241012] text-red-100",
    iconClass: "bg-red-500/15 text-red-400",
    icon: AlertTriangle,
    label: "Alerta",
    role: "alertdialog",
  },
  success: {
    dialogClass: "border-emerald-500/30 bg-[#0d211b] text-emerald-100",
    iconClass: "bg-emerald-500/15 text-emerald-400",
    icon: CheckCircle2,
    label: "Concluído",
    role: "dialog",
  },
  info: {
    dialogClass: "border-cyan-500/30 bg-[#0c1d26] text-cyan-100",
    iconClass: "bg-cyan-500/15 text-cyan-400",
    icon: Info,
    label: "Aviso",
    role: "dialog",
  },
};

export function VideoEditorClient() {
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const statusVariant = status ? statusVariants[status.type] : null;
  const StatusIcon = statusVariant?.icon;

  useEffect(() => {
    if (!status) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStatus(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [status]);

  return (
    <div className="h-full overflow-y-auto bg-[#09090a] px-3 py-3 text-zinc-100 md:px-4">
      <div className="mx-auto max-w-[1600px]">
        <header className="hidden">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-violet-600/10 blur-3xl" />
          <div className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-emerald-600/10 blur-3xl" />

          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-violet-400">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
                  <Video size={13} />
                </span>
                Estúdio de conteúdo
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Edição de vídeo</h1>
              <p className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-400 md:text-sm">
                Importe do computador ou Google Drive, edite e renderize localmente. Depois, envie ao Drive ou prepare para o DaVinci se quiser.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 shadow-sm backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                DaVinci Resolve Free
              </span>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3.5 py-1.5 text-xs font-semibold text-violet-300 shadow-sm backdrop-blur-md">
                <Cpu size={13} />
                Diretor AI Kaoz.1
              </span>
            </div>
          </div>
        </header>

        {status && statusVariant && StatusIcon && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role={statusVariant.role}
            aria-modal="true"
            aria-labelledby="video-editor-status-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setStatus(null);
            }}
          >
            <div
              className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${statusVariant.dialogClass}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${statusVariant.iconClass}`}
                >
                  <StatusIcon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id="video-editor-status-title" className="text-sm font-bold">
                    {statusVariant.label}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-white/80">{status.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStatus(null)}
                  className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Fechar aviso"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStatus(null)}
                  className="rounded-lg bg-white/10 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20"
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>
        )}

        <DavinciFreePanel onStatusMessage={setStatus} />
      </div>
    </div>
  );
}
