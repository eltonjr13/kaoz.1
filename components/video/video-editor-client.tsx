"use client";

import { useState } from "react";
import { Video } from "lucide-react";
import { DavinciFreePanel } from "@/components/settings/DavinciFreePanel";

type StatusMessage = { text: string; type: "success" | "error" | "info" };

export function VideoEditorClient() {
  const [status, setStatus] = useState<StatusMessage | null>(null);
  return (
    <div className="h-full overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-violet-300"><Video size={14} /> Estúdio de conteúdo</p>
            <h1 className="text-2xl font-bold tracking-tight text-white">Edição de vídeo</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">Analise, revise e renderize aulas com decisões editoriais antes de enviá-las ao DaVinci Resolve.</p>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1 text-xs font-medium text-emerald-300">DaVinci Resolve Free</span>
        </header>
        {status && <div className={`rounded-lg border px-4 py-3 text-sm ${status.type === "error" ? "border-red-400/25 bg-red-400/5 text-red-200" : status.type === "success" ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200" : "border-cyan-400/25 bg-cyan-400/5 text-cyan-200"}`}>{status.text}</div>}
        <DavinciFreePanel onStatusMessage={setStatus} />
      </div>
    </div>
  );
}
