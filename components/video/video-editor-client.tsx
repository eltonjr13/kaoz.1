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
    dialogClass: "border-[#A6A297]/35 bg-[#261D01] text-[#F2F2F2]",
    iconClass: "bg-[#736D5C]/25 text-[#D6D4CD]",
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
    <div className="flex min-h-0 flex-1 overflow-y-auto w-full flex-col bg-[#1A1301] text-[#F2F2F2]">
      <div className="min-h-full w-full flex-none overflow-visible">
        <DavinciFreePanel onStatusMessage={setStatus} />
      </div>

      {status && statusVariant && StatusIcon && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1A1301]/80 p-4 backdrop-blur-sm"
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
                className="rounded-lg p-1 text-[#A6A297] transition-colors hover:bg-[#736D5C]/30 hover:text-[#F2F2F2]"
                aria-label="Fechar aviso"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setStatus(null)}
                className="rounded-lg border border-[#736D5C]/50 bg-[#403106] px-4 py-2 text-xs font-bold text-[#F2F2F2] transition-colors hover:bg-[#736D5C]"
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
