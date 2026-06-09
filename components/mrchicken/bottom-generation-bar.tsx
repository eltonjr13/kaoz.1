"use client";

import { ChevronRight, Download, FileText, Film, MoreHorizontal, Plus } from "lucide-react";

// Sub-component: ProgressRow
export function ProgressRow({
  label,
  subLabel,
  percentage,
}: {
  label: string;
  subLabel: string;
  percentage: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-[11px]">
      <div className="w-1/3 font-semibold text-[var(--text)] truncate">{label}</div>
      <div className="w-1/3 text-[var(--muted)] font-mono text-[10px] truncate">{subLabel}</div>
      <div className="flex items-center gap-2.5 w-1/3">
        {/* Progress bar container */}
        <div className="flex-1 h-[5px] bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          {/* Progress bar fill (vibrant blue indicator) */}
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
        <span className="font-mono font-bold text-[10px] text-[var(--text)] min-w-[28px] text-right">
          {percentage}%
        </span>
      </div>
    </div>
  );
}

// Sub-component: StatusRow
export function StatusRow({
  label,
  icon: Icon,
  onAdd,
}: {
  label: string;
  icon: any;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between border border-[var(--line)] bg-zinc-50 dark:bg-zinc-900/30 rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-150 text-[11px]">
      <div className="flex items-center gap-2 text-[var(--text)] font-semibold">
        <Icon size={12} className="text-zinc-500" />
        <span>{label}</span>
      </div>
      <button
        onClick={onAdd}
        className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer p-0.5 rounded transition-colors duration-150"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

// Sub-component: ExportItem
export function ExportItem({
  title,
  subtitle,
  thumbnailUrl,
}: {
  title: string;
  subtitle: string;
  thumbnailUrl?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors duration-150 cursor-pointer text-[11px]">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Tiny black thumbnail */}
        <div className="w-10 h-7 bg-zinc-950 rounded border border-zinc-800 flex items-center justify-center shrink-0 overflow-hidden relative">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={title} className="w-full h-full object-cover filter grayscale" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-950 flex items-center justify-center">
              <Film size={8} className="text-white/20" />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h5 className="font-bold text-[var(--text)] truncate leading-none mb-1">{title}</h5>
          <p className="text-[9px] font-mono text-[var(--muted)] leading-none truncate">{subtitle}</p>
        </div>
      </div>

      <ChevronRight size={12} className="text-zinc-400 shrink-0" />
    </div>
  );
}

// Main component: BottomGenerationBar
export function BottomGenerationBar() {
  return (
    <footer className="w-full bg-[var(--bg-soft)] border-t border-[var(--line)] p-4 flex flex-col md:grid md:grid-cols-3 gap-6 h-auto md:h-[135px] overflow-y-auto">
      {/* Block 1: GENERATION QUEUE */}
      <div className="flex flex-col justify-between">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[9px] font-mono font-bold tracking-wider text-[var(--muted)] uppercase">
            Generation Queue
          </span>
          <button className="text-zinc-400 hover:text-zinc-650">
            <MoreHorizontal size={12} />
          </button>
        </div>
        <div className="space-y-1">
          <ProgressRow label="Generation Queue" subLabel="Rendering Progress" percentage={90} />
          <ProgressRow label="Rendering Progress" subLabel="Rendering Progress Fill" percentage={75} />
          <ProgressRow label="Rendering Progress" subLabel="Rendering Progress" percentage={70} />
        </div>
      </div>

      {/* Block 2: AVATAR STATUS */}
      <div className="flex flex-col justify-between border-t md:border-t-0 md:border-x border-[var(--line)] pt-4 md:pt-0 md:px-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[9px] font-mono font-bold tracking-wider text-[var(--muted)] uppercase">
            Avatar Status
          </span>
          <button className="text-zinc-400 hover:text-zinc-650">
            <MoreHorizontal size={12} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <StatusRow label="Script Generator" icon={FileText} />
          <StatusRow label="Video Composer" icon={Film} />
          <StatusRow label="Export Pipeline" icon={Download} />
        </div>
      </div>

      {/* Block 3: RECENT EXPORTS */}
      <div className="flex flex-col justify-between border-t md:border-t-0 pt-4 md:pt-0 md:pl-2">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[9px] font-mono font-bold tracking-wider text-[var(--muted)] uppercase">
            Recent Exports
          </span>
          <button className="text-zinc-400 hover:text-zinc-650">
            <MoreHorizontal size={12} />
          </button>
        </div>
        <div className="space-y-1.5">
          <ExportItem title="MRchicken Lear Video 1" subtitle="Render er1 2:33 PM" />
          <ExportItem title="MRchicken Lear Video 2" subtitle="Render er1 2:00 PM" />
        </div>
      </div>
    </footer>
  );
}
