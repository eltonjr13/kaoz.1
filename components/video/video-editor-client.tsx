"use client";

import { useState } from "react";
import { Video, Sparkles, Cpu, CheckCircle2 } from "lucide-react";
import { DavinciFreePanel } from "@/components/settings/DavinciFreePanel";

type StatusMessage = { text: string; type: "success" | "error" | "info" };

export function VideoEditorClient() {
  const [status, setStatus] = useState<StatusMessage | null>(null);

  return (
    <div className="h-full overflow-y-auto bg-[#09090a] px-3 py-3 text-zinc-100 md:px-4">
      <div className="mx-auto max-w-[1600px]">
        {/* Header Principal - Studio Dark */}
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
              <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                Edição de vídeo
              </h1>
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

        {/* Notificação de Status */}
        {status && (
          <div
            className={`mb-3 flex items-center gap-3 rounded-md border px-3 py-2 text-xs font-medium transition-all ${
              status.type === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-200"
                : status.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
            }`}
          >
            {status.type === "success" ? (
              <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            ) : status.type === "error" ? (
              <span className="shrink-0 font-bold text-red-400">⚠️</span>
            ) : (
              <Sparkles size={16} className="shrink-0 text-cyan-400" />
            )}
            <span className="leading-snug">{status.text}</span>
          </div>
        )}

        {/* Painel Principal */}
        <DavinciFreePanel onStatusMessage={setStatus} />
      </div>
    </div>
  );
}
