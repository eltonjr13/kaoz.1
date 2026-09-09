"use client";

import React from 'react';
import { Square, Smartphone, Monitor, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import type { FlowSupportedAspectRatio } from '@/types/sketch';

export interface SketchFormatSelectorProps {
  aspectRatio: FlowSupportedAspectRatio;
  onChange: (ratio: FlowSupportedAspectRatio) => void;
  disabled?: boolean;
}

interface FormatOption {
  ratio: FlowSupportedAspectRatio;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { ratio: '1:1', label: '1:1', sublabel: 'Feed', icon: Square },
  { ratio: '9:16', label: '9:16', sublabel: 'Stories/Reels', icon: Smartphone },
  { ratio: '16:9', label: '16:9', sublabel: 'Banner/Vídeo', icon: Monitor },
  { ratio: '4:3', label: '4:3', sublabel: 'Padrão', icon: RectangleHorizontal },
  { ratio: '3:4', label: '3:4', sublabel: 'Retrato', icon: RectangleVertical },
];

export function SketchFormatSelector({
  aspectRatio,
  onChange,
  disabled = false,
}: SketchFormatSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium text-zinc-400">Formato / Proporção</label>
      <div className="flex flex-wrap items-center gap-2">
        {FORMAT_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = aspectRatio === opt.ratio;
          return (
            <button
              key={opt.ratio}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.ratio)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all duration-150 disabled:opacity-50 ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300 shadow-sm shadow-indigo-950'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <Icon size={13} className={isSelected ? 'text-indigo-400' : 'text-zinc-500'} />
              <span>{opt.label}</span>
              <span className="text-[10px] text-zinc-500">({opt.sublabel})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
