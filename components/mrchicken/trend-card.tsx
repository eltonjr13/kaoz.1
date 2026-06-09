"use client";

import { MoreHorizontal, Play, X } from "lucide-react";

interface TrendCardProps {
  title: string;
  timestamp: string;
  topic: string;
  bullets: string[];
  thumbnailUrl?: string;
  hasPlay?: boolean;
}

export function TrendCard({
  title,
  timestamp,
  topic,
  bullets,
  thumbnailUrl,
  hasPlay = false,
}: TrendCardProps) {
  return (
    <div className="group bg-[var(--bg-soft)] border border-[var(--line)] rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-150 ease-in-out">
      {/* Thumbnail area */}
      <div className="relative aspect-[16/10] bg-zinc-950 overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="w-full h-full object-cover filter grayscale opacity-80 group-hover:scale-105 transition-transform duration-300 ease-out"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-tr from-zinc-900 via-zinc-800 to-zinc-950 flex items-center justify-center opacity-90">
            {/* Abstract visual */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
          </div>
        )}

        {/* Overlays */}
        <div className="absolute inset-0 p-3 flex flex-col justify-between text-white bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none">
          <div className="flex justify-between items-center w-full">
            <span className="text-[10px] font-medium tracking-wide uppercase opacity-90 font-mono">
              {title}
            </span>
            <button className="pointer-events-auto text-white/70 hover:text-white transition-colors duration-150">
              <X size={12} />
            </button>
          </div>

          <div className="flex justify-between items-end w-full">
            <span className="text-[10px] opacity-75 font-mono">{timestamp}</span>
            {/* TikTok Icon SVG */}
            <svg
              className="w-3.5 h-3.5 fill-current opacity-80"
              viewBox="0 0 24 24"
              aria-label="TikTok"
            >
              <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.59 4.23.99 1.13 2.37 1.93 3.86 2.22.01 1.25.01 2.5.01 3.75-.76-.08-1.52-.3-2.24-.62-.97-.43-1.83-1.07-2.5-1.89-.01 2.36-.01 4.72-.01 7.08-.12 2.44-1.37 4.79-3.4 6.13-2.12 1.48-5.06 1.76-7.39.73-2.4-1.02-4.04-3.54-4.03-6.17.02-2.82 2.03-5.46 4.81-6.04.83-.17 1.69-.19 2.52-.06v3.91c-.55-.07-1.12-.04-1.65.13-1.04.33-1.83 1.26-1.95 2.36-.18 1.48.88 2.87 2.37 3.05 1.47.16 2.88-.81 3.09-2.29.05-.33.05-.67.05-1.01V0h-2.52Z" />
            </svg>
          </div>
        </div>

        {hasPlay && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/95 text-black hover:scale-105 hover:bg-white transition-transform duration-150 shadow-md">
              <Play size={16} fill="currentColor" className="ml-0.5" />
            </button>
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="p-3.5 flex justify-between items-start gap-2">
        <div className="flex-1">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-[var(--text)] mb-2">
            {topic}
          </h4>
          <ul className="space-y-1">
            {bullets.map((bullet, idx) => (
              <li
                key={idx}
                className="text-[11px] text-[var(--muted)] flex items-start gap-1.5 leading-relaxed"
              >
                <span className="text-zinc-400 select-none">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <button className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 p-0.5 rounded transition-colors duration-150">
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}
