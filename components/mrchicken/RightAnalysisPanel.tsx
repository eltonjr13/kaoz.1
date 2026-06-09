"use client";

import React from "react";
import { Play, X, Check } from "lucide-react";

export function RightAnalysisPanel() {
  return (
    <aside className="w-[270px] bg-mr-bg border-l border-mr-border p-[18px] flex flex-col h-full flex-shrink-0 select-none overflow-y-auto">
      {/* Player Preview */}
      <div className="relative aspect-[4/3] w-full bg-zinc-950 rounded-lg overflow-hidden flex items-center justify-center mr-shadow-sm border border-zinc-900 mb-5 group">
        {/* Technical overlay grid */}
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:8px_8px]" />
        
        {/* Fine technical overlay lines */}
        <div className="absolute top-0 bottom-0 left-[15%] w-[0.5px] bg-white/5" />
        <div className="absolute top-0 bottom-0 right-[15%] w-[0.5px] bg-white/5" />
        <div className="absolute left-0 right-0 top-[20%] h-[0.5px] bg-white/5" />
        <div className="absolute left-0 right-0 bottom-[20%] h-[0.5px] bg-white/5" />

        {/* Small text in top-left */}
        <span className="absolute top-2.5 left-2.5 text-[8px] font-mono text-zinc-500 tracking-wider">
          LIVE PREVIEW
        </span>

        {/* Close button in top-right */}
        <button className="absolute top-2 right-2 text-zinc-500 hover:text-white transition-colors duration-150">
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Play button */}
        <button className="w-9 h-9 rounded-full bg-white flex items-center justify-center mr-shadow-md hover:scale-105 active:scale-95 transition-transform duration-100">
          <Play className="w-3.5 h-3.5 text-zinc-950 fill-zinc-950 ml-0.5" />
        </button>

        {/* Progress bar at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
          <div className="w-[45%] h-full bg-white" />
        </div>
      </div>

      {/* Analysis Details */}
      <div className="flex-grow flex flex-col gap-5">
        <div>
          <h3 className="text-xs font-bold text-mr-text-primary uppercase tracking-wider font-sans mb-1.5">
            In-depth AI Analysis
          </h3>
          <p className="text-[11px] text-mr-text-secondary leading-normal">
            Targeting high engagement curves through segmented hook sequences and avatar-synchronized scripts.
          </p>
        </div>

        <hr className="border-mr-border" />

        {/* Two Metrics Side-by-Side */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <span className="text-lg font-extrabold text-mr-text-primary tracking-tight">
              427k
            </span>
            <span className="text-[9px] font-semibold text-mr-text-secondary uppercase tracking-wide leading-none mt-1">
              Est. engagement
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-extrabold text-mr-text-primary tracking-tight">
              23%
            </span>
            <span className="text-[9px] font-semibold text-mr-text-secondary uppercase tracking-wide leading-none mt-1">
              Est. reactions
            </span>
          </div>
        </div>

        <hr className="border-mr-border" />

        {/* Reaction Suggestions */}
        <div>
          <h4 className="text-[10px] font-bold text-mr-text-primary uppercase tracking-wider font-sans mb-2.5">
            Reaction suggestions
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {["In-reaction", "Inreactions", "Reactor suggestions", "Re..."].map(
              (suggestion, idx) => (
                <span
                  key={idx}
                  className="px-2 py-1 bg-white border border-mr-border rounded text-[10px] text-mr-text-primary font-medium hover:bg-zinc-100 hover:text-mr-text-primary cursor-pointer transition-colors duration-150"
                >
                  {suggestion}
                </span>
              )
            )}
          </div>
        </div>

        {/* Avatar Compatibility */}
        <div className="flex items-center justify-between py-1 bg-white/50 rounded border border-transparent hover:border-mr-border px-1.5 transition-colors">
          <span className="text-[11px] font-semibold text-mr-text-primary uppercase tracking-wide">
            Avatar compatibility
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-mr-text-secondary uppercase">
              Status
            </span>
            <span className="w-4.5 h-4.5 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-emerald-600 stroke-[3]" />
            </span>
          </div>
        </div>
      </div>

      {/* Primary CTA */}
      <button className="w-full h-[42px] bg-mr-text-primary hover:bg-zinc-800 active:bg-black text-white text-[11px] font-bold tracking-widest uppercase rounded-md transition-all duration-150 mt-auto shadow-sm select-none">
        GENERATE REACTION PROJECT
      </button>
    </aside>
  );
}
