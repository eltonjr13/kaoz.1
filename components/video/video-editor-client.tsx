"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Info, Sparkles, Video, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DavinciFreePanel } from "@/components/settings/DavinciFreePanel";

type StatusMessage = { text: string; type: "success" | "error" | "info" };

const statusVariants: Record<
  StatusMessage["type"],
  { dialogClass: string; iconClass: string; icon: LucideIcon; label: string }
> = {
  error: {
    dialogClass: "border-red-500/30 bg-[#241012] text-red-100",
    iconClass: "bg-red-500/15 text-red-400",
    icon: AlertTriangle,
    label: "Alerta",
  },
  success: {
    dialogClass: "border-emerald-500/30 bg-[#0d211b] text-emerald-100",
    iconClass: "bg-emerald-500/15 text-emerald-400",
    icon: CheckCircle2,
    label: "Concluído",
  },
  info: {
    dialogClass: "border-[#8B92A1]/35 bg-[#101217] text-[#F4F5F7]",
    iconClass: "bg-[#383D49]/25 text-[#D5D8E0]",
    icon: Info,
    label: "Aviso",
  },
};

type StatusOverlayProps = {
  status: StatusMessage;
  variant: (typeof statusVariants)[StatusMessage["type"]];
  Icon: LucideIcon;
  onClose: () => void;
};

function UrgentStatusModal({ status, variant, Icon, onClose }: StatusOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#090A0D]/80 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="video-editor-status-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${variant.dialogClass}`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${variant.iconClass}`}>
            <Icon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="video-editor-status-title" className="text-sm font-bold">{variant.label}</h2>
            <p className="mt-1 text-sm leading-relaxed text-white/80">{status.text}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[#8B92A1] transition-colors hover:bg-[#383D49]/30 hover:text-[#F4F5F7]" aria-label="Fechar aviso">
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#383D49]/50 bg-[#171A21] px-4 py-2 text-xs font-bold text-[#F4F5F7] transition-colors hover:bg-[#383D49]">
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

function SideStatusNotification({ status, variant, Icon, onClose }: StatusOverlayProps) {
  return (
    <div className="fixed right-4 top-4 z-[100] w-[calc(100%-2rem)] max-w-sm" role="status" aria-live="polite">
      <div className={`rounded-2xl border p-4 shadow-2xl ${variant.dialogClass}`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${variant.iconClass}`}>
            <Icon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{variant.label}</p>
            <p className="mt-1 text-sm leading-relaxed text-white/80">{status.text}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[#8B92A1] transition-colors hover:bg-[#383D49]/30 hover:text-[#F4F5F7]" aria-label="Fechar notifica\u00e7\u00e3o">
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function VideoEditorClient() {
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const statusVariant = status ? statusVariants[status.type] : null;
  const StatusIcon = statusVariant?.icon;
  const isUrgentStatus = status?.type === "error";

  useEffect(() => {
    if (!status || isUrgentStatus) return;

    const timeout = window.setTimeout(() => setStatus(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [isUrgentStatus, status]);

  useEffect(() => {
    if (!isUrgentStatus) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStatus(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isUrgentStatus]);

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto w-full flex-col bg-[#090A0D] text-[#F4F5F7]">
      <div className="min-h-full w-full flex-none overflow-visible">
        <DavinciFreePanel onStatusMessage={setStatus} />
      </div>

      {status && statusVariant && StatusIcon && (
        isUrgentStatus
          ? <UrgentStatusModal status={status} variant={statusVariant} Icon={StatusIcon} onClose={() => setStatus(null)} />
          : <SideStatusNotification status={status} variant={statusVariant} Icon={StatusIcon} onClose={() => setStatus(null)} />
      )}
    </div>
  );
}
