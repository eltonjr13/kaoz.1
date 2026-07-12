"use client";

import { Check, Play, X } from "lucide-react";

interface RightAnalysisPanelProps {
  onGenerate?: () => void;
}

export function RightAnalysisPanel({ onGenerate }: RightAnalysisPanelProps) {
  return (
    <aside className="w-full xl:w-[270px] xl:shrink-0 bg-[var(--bg-soft)] border-t xl:border-t-0 xl:border-l border-[var(--line)] p-[18px] flex flex-col justify-between h-full overflow-y-auto">
      <div className="space-y-5">
        {/* Technical Player Preview */}
        <div className="relative aspect-[16/10] bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 flex items-center justify-center p-3 shadow-md">
          {/* Viewfinder corner overlays (futuristic technical lines) */}
          <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t border-l border-white/20"></div>
          <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t border-r border-white/20"></div>
          <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b border-l border-white/20"></div>
          <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b border-r border-white/20"></div>

          {/* Text markers */}
          <div className="absolute top-2 left-3 text-[7px] text-white/50 font-mono tracking-tight select-none">
            MINIMALLIST LAYER PREVIEW
          </div>

          <div className="absolute bottom-3 right-3 text-[7px] text-white/40 font-mono select-none">
            00:07 / 00:42
          </div>

          <button className="absolute top-2 right-2 text-white/50 hover:text-white transition-colors duration-150 z-20">
            <X size={10} />
          </button>

          {/* Centered Play Button */}
          <button className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform duration-150 shadow-lg z-10 cursor-pointer">
            <Play size={13} fill="currentColor" className="ml-0.5" />
          </button>

          {/* Technical Center Reticle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-25">
            <div className="w-6 h-px bg-white"></div>
            <div className="h-6 w-px bg-white"></div>
          </div>

          {/* White progress bar at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-zinc-800">
            <div className="h-full w-[23%] bg-white"></div>
          </div>
        </div>

        {/* Content Section */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text)]">
              In-depth AI Analysis
            </h3>
            <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-[var(--muted)] mb-3">
            Minimalist AI analysis, model at non-matter and tan analysis and independent reaction requires in-depth AI analysis, declares recommendation, following checks of engagement automatically.
          </p>

          <div className="border-t border-[var(--line)] my-3"></div>

          {/* Double Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[13px] font-extrabold tracking-tight text-[var(--text)]">427k</span>
              <p className="text-[9px] font-mono text-[var(--muted)] mt-0.5 leading-none">
                Estimated engagement
              </p>
            </div>
            <div className="border-l border-[var(--line)] pl-4">
              <span className="text-[13px] font-extrabold tracking-tight text-[var(--text)]">23%</span>
              <p className="text-[9px] font-mono text-[var(--muted)] mt-0.5 leading-none">
                Estimated reactions
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--line)] my-3"></div>

          {/* Reaction Suggestions */}
          <div className="mb-4">
            <h4 className="text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--muted)] mb-2">
              Reaction suggestions
            </h4>
            <div className="flex flex-wrap gap-1">
              {["In-reaction", "Inreactions", "Reactor suggestions", "Re..."].map((suggestion, idx) => (
                <span
                  key={idx}
                  className="text-[9px] font-mono bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-[var(--text)] border border-[var(--line)] px-2 py-0.5 rounded cursor-pointer transition-colors duration-150"
                >
                  {suggestion}
                </span>
              ))}
            </div>
          </div>

          {/* Avatar Compatibility */}
          <div className="flex justify-between items-center py-2 px-2.5 rounded bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--line)]">
            <span className="text-[10px] font-mono font-semibold text-[var(--text)] uppercase tracking-wide">
              Avatar compatibility
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-[var(--muted)]">Status</span>
              <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Check size={9} strokeWidth={3} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Action Button */}
      <button
        onClick={onGenerate}
        className="w-full bg-zinc-950 hover:bg-zinc-850 active:bg-zinc-900 text-white font-mono font-bold text-[11px] py-3 tracking-wider rounded-md border border-zinc-800 transition-colors duration-150 uppercase text-center mt-5 cursor-pointer shadow-[0_2px_4px_rgba(0,0,0,0.1)] dark:bg-white dark:text-black dark:border-white dark:hover:bg-zinc-100"
      >
        GENERATE REACTION PROJECT
      </button>
    </aside>
  );
}
