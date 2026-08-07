"use client";

import { useEffect, useRef, useState } from "react";
import {
  Terminal,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
  Search,
  Check,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  Video,
  ArrowDownCircle,
} from "lucide-react";

export type ConsoleLogLevel = "info" | "success" | "warn" | "error" | "ffmpeg";

export type ConsoleLogEntry = {
  id: string;
  timestamp: string;
  level: ConsoleLogLevel;
  message: string;
  details?: string;
};

type VideoEditorConsoleProps = {
  logs: ConsoleLogEntry[];
  onClearLogs: () => void;
  isProcessing?: boolean;
};

const levelBadgeStyles: Record<ConsoleLogLevel, { bg: string; text: string; icon: React.ElementType }> = {
  info: { bg: "bg-cyan-500/15 border-cyan-500/30 text-cyan-300", text: "INFO", icon: Info },
  success: { bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300", text: "SUCCESS", icon: CheckCircle2 },
  warn: { bg: "bg-amber-500/15 border-amber-500/30 text-amber-300", text: "WARN", icon: AlertTriangle },
  error: { bg: "bg-red-500/15 border-red-500/30 text-red-300", text: "ERROR", icon: XCircle },
  ffmpeg: { bg: "bg-violet-500/15 border-violet-500/30 text-violet-300", text: "FFMPEG", icon: Video },
};

export function VideoEditorConsole({ logs, onClearLogs, isProcessing = false }: VideoEditorConsoleProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [selectedLevel, setSelectedLevel] = useState<"all" | ConsoleLogLevel>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = selectedLevel === "all" || log.level === selectedLevel;
    const matchesSearch =
      !searchQuery ||
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.details && log.details.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesLevel && matchesSearch;
  });

  useEffect(() => {
    if (autoScroll && logContainerRef.current && isOpen) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll, isOpen]);

  function handleCopy() {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}${l.details ? `\n  ${l.details}` : ""}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const counts = {
    all: logs.length,
    info: logs.filter((l) => l.level === "info").length,
    success: logs.filter((l) => l.level === "success").length,
    warn: logs.filter((l) => l.level === "warn").length,
    error: logs.filter((l) => l.level === "error").length,
    ffmpeg: logs.filter((l) => l.level === "ffmpeg").length,
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur-xl transition-all duration-300">
      {/* Header do Console */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-zinc-900/80 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-200 transition hover:text-white"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/20 text-violet-400">
              <Terminal size={14} />
            </span>
            Console de Processamento
            {isProcessing && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
          </button>

          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-400">
            {logs.length} {logs.length === 1 ? "registro" : "registros"}
          </span>
        </div>

        {/* Controles do Console */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoScroll((prev) => !prev)}
            title={autoScroll ? "Auto-scroll ativado" : "Auto-scroll desativado"}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
              autoScroll
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <ArrowDownCircle size={12} />
            <span className="hidden sm:inline">Auto-scroll</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={logs.length === 0}
            title="Copiar logs"
            className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-700 hover:text-white disabled:opacity-40"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            <span className="hidden sm:inline">{copied ? "Copiado!" : "Copiar"}</span>
          </button>

          <button
            type="button"
            onClick={onClearLogs}
            disabled={logs.length === 0}
            title="Limpar logs"
            className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300 transition hover:bg-red-500/20 disabled:opacity-40"
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline">Limpar</span>
          </button>

          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 p-1 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
            title={isOpen ? "Recolher console" : "Expandir console"}
          >
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-3">
          {/* Barra de Filtros e Busca */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(["all", "info", "success", "warn", "error", "ffmpeg"] as const).map((level) => {
                const isSelected = selectedLevel === level;
                const count = counts[level];
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSelectedLevel(level)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                      isSelected
                        ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                        : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {level === "all" ? "Todos" : level.toUpperCase()}{" "}
                    <span className="ml-1 opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full max-w-xs">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Filtrar mensagens..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/50 py-1 pl-8 pr-3 text-[11px] text-zinc-200 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50"
              />
            </div>
          </div>

          {/* Área de Logs Terminal */}
          <div
            ref={logContainerRef}
            className="h-64 overflow-y-auto rounded-xl border border-black/80 bg-black/90 p-3 font-mono text-xs text-zinc-200 shadow-inner scrollbar-thin scrollbar-thumb-zinc-700"
          >
            {filteredLogs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-zinc-500">
                <Terminal size={24} className="mb-2 opacity-40" />
                <p className="text-xs">Nenhum log gravado até o momento.</p>
                <p className="mt-1 text-[10px] text-zinc-600">
                  As mensagens de transcrição, processamento FFmpeg e renderização aparecerão aqui.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredLogs.map((log) => {
                  const badge = levelBadgeStyles[log.level];
                  const IconComponent = badge.icon;
                  return (
                    <div
                      key={log.id}
                      className="group flex flex-col gap-0.5 rounded-md px-2 py-1 transition hover:bg-white/[0.03]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] text-zinc-500">{log.timestamp}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold ${badge.bg}`}
                        >
                          <IconComponent size={10} />
                          {badge.text}
                        </span>
                        <span className="break-all font-medium text-zinc-200">{log.message}</span>
                      </div>
                      {log.details && (
                        <div className="ml-14 rounded border border-white/5 bg-zinc-900/60 p-1.5 text-[11px] text-zinc-400 whitespace-pre-wrap">
                          {log.details}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
