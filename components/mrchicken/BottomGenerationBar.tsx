"use client";

import React from "react";
import {
  FileText,
  Video,
  ExternalLink,
  Plus,
  ChevronRight,
  Sparkles,
  Play,
} from "lucide-react";

export function BottomGenerationBar() {
  return (
    <footer className="h-[130px] bg-mr-bg border-t border-mr-border px-6 flex items-center justify-between gap-6 select-none flex-shrink-0">
      
      {/* Block 1: GENERATION QUEUE */}
      <div className="flex-1 min-w-[200px] h-full flex flex-col justify-center border-r border-mr-border pr-6">
        <h3 className="text-[10px] font-bold text-mr-text-primary uppercase tracking-wider font-sans mb-2">
          Generation Queue
        </h3>
        <div className="space-y-1.5 overflow-y-auto max-h-[80px]">
          {/* Item 1 */}
          <div className="flex items-center justify-between text-[10px] text-mr-text-primary font-medium">
            <span className="truncate mr-2">Rendering Progress #1</span>
            <div className="flex items-center gap-2 flex-grow max-w-[120px] justify-end">
              <div className="w-16 h-1 bg-zinc-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: "80%" }} />
              </div>
              <span className="font-mono text-mr-text-secondary w-6 text-right">80%</span>
            </div>
          </div>
          {/* Item 2 */}
          <div className="flex items-center justify-between text-[10px] text-mr-text-primary font-medium">
            <span className="truncate mr-2">Rendering Progress #2</span>
            <div className="flex items-center gap-2 flex-grow max-w-[120px] justify-end">
              <div className="w-16 h-1 bg-zinc-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: "75%" }} />
              </div>
              <span className="font-mono text-mr-text-secondary w-6 text-right">75%</span>
            </div>
          </div>
          {/* Item 3 */}
          <div className="flex items-center justify-between text-[10px] text-mr-text-primary font-medium">
            <span className="truncate mr-2">Rendering Progress #3</span>
            <div className="flex items-center gap-2 flex-grow max-w-[120px] justify-end">
              <div className="w-16 h-1 bg-zinc-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: "70%" }} />
              </div>
              <span className="font-mono text-mr-text-secondary w-6 text-right">70%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Block 2: AVATAR STATUS */}
      <div className="flex-1 min-w-[200px] h-full flex flex-col justify-center border-r border-mr-border pr-6">
        <h3 className="text-[10px] font-bold text-mr-text-primary uppercase tracking-wider font-sans mb-2">
          Avatar Status
        </h3>
        <div className="space-y-1.5 overflow-y-auto max-h-[80px]">
          {/* Item 1 */}
          <div className="flex items-center justify-between text-[10px] text-mr-text-primary font-medium group">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-mr-text-secondary group-hover:text-mr-text-primary transition-colors stroke-[1.5]" />
              <span>Script Generator</span>
            </div>
            <button className="p-0.5 border border-mr-border rounded hover:bg-zinc-100 transition-colors">
              <Plus className="w-2.5 h-2.5 text-mr-text-secondary" />
            </button>
          </div>
          {/* Item 2 */}
          <div className="flex items-center justify-between text-[10px] text-mr-text-primary font-medium group">
            <div className="flex items-center gap-2">
              <Video className="w-3.5 h-3.5 text-mr-text-secondary group-hover:text-mr-text-primary transition-colors stroke-[1.5]" />
              <span>Video Composer</span>
            </div>
            <button className="p-0.5 border border-mr-border rounded hover:bg-zinc-100 transition-colors">
              <Plus className="w-2.5 h-2.5 text-mr-text-secondary" />
            </button>
          </div>
          {/* Item 3 */}
          <div className="flex items-center justify-between text-[10px] text-mr-text-primary font-medium group">
            <div className="flex items-center gap-2">
              <ExternalLink className="w-3.5 h-3.5 text-mr-text-secondary group-hover:text-mr-text-primary transition-colors stroke-[1.5]" />
              <span>Export Pipeline</span>
            </div>
            <button className="p-0.5 border border-mr-border rounded hover:bg-zinc-100 transition-colors">
              <Plus className="w-2.5 h-2.5 text-mr-text-secondary" />
            </button>
          </div>
        </div>
      </div>

      {/* Block 3: RECENT EXPORTS */}
      <div className="flex-1 min-w-[220px] h-full flex flex-col justify-center">
        <h3 className="text-[10px] font-bold text-mr-text-primary uppercase tracking-wider font-sans mb-2">
          Recent Exports
        </h3>
        <div className="space-y-1.5 overflow-y-auto max-h-[80px]">
          {/* Export item 1 */}
          <div className="flex items-center justify-between group cursor-pointer hover:bg-white/50 p-1 rounded transition-colors duration-100">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 bg-zinc-950 rounded flex items-center justify-center flex-shrink-0 relative">
                <Play className="w-2 h-2 text-white fill-white ml-[0.5px]" />
              </div>
              <div className="min-w-0 flex flex-col">
                <span className="text-[10px] font-bold text-mr-text-primary truncate">
                  MRchicken Lear Video 1
                </span>
                <span className="text-[8px] text-mr-text-secondary leading-none mt-0.5 font-mono">
                  Render er1 • 2:33 PM
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-mr-text-tertiary group-hover:text-mr-text-primary transition-colors flex-shrink-0" />
          </div>

          {/* Export item 2 */}
          <div className="flex items-center justify-between group cursor-pointer hover:bg-white/50 p-1 rounded transition-colors duration-100">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 bg-zinc-950 rounded flex items-center justify-center flex-shrink-0 relative">
                <Play className="w-2 h-2 text-white fill-white ml-[0.5px]" />
              </div>
              <div className="min-w-0 flex flex-col">
                <span className="text-[10px] font-bold text-mr-text-primary truncate">
                  MRchicken Lear Video 2
                </span>
                <span className="text-[8px] text-mr-text-secondary leading-none mt-0.5 font-mono">
                  Render er1 • 2:00 PM
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-mr-text-tertiary group-hover:text-mr-text-primary transition-colors flex-shrink-0" />
          </div>
        </div>
      </div>

    </footer>
  );
}
