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
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#09090a] text-zinc-100">
      <div className="flex-1 min-h-0 overflow-hidden">
        <DavinciFreePanel onStatusMessage={setStatus} />
      </div>

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
    </div>
  );
}
