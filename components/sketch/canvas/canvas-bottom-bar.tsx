"use client";

import React from 'react';
import { Pipette } from 'lucide-react';

interface CanvasBottomBarProps {
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  isCleanPreview: boolean;
}

const PALETTE = [
  '#ffffff',
  '#cbd5e1',
  '#64748b',
  '#1e293b',
  '#000000',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
];

export function CanvasBottomBar({
  strokeColor,
  setStrokeColor,
  isCleanPreview,
}: CanvasBottomBarProps) {
  if (isCleanPreview) return null;

  return (
    <footer
      aria-label="Paleta de cores"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 sm:gap-2 rounded-2xl border border-zinc-800/90 bg-[#0d1017]/95 px-3 py-2 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center gap-1">
        {PALETTE.map((c) => {
          const isSelected = strokeColor.toLowerCase() === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              onClick={() => setStrokeColor(c)}
              title={c}
              className={`h-5 w-5 sm:h-6 sm:w-6 rounded-full transition-transform hover:scale-110 ${
                isSelected ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-[#0d1017] scale-110' : ''
              }`}
              style={{
                backgroundColor: c,
                border: c === '#000000' || c === '#1e293b' ? '1px solid #334155' : '1px solid transparent',
              }}
            />
          );
        })}
      </div>

      <div className="h-4 w-px bg-zinc-800" />

      {/* Custom color picker */}
      <label
        title="Escolher cor personalizada"
        className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Pipette size={12} />
        <input
          type="color"
          value={strokeColor}
          onChange={(e) => setStrokeColor(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </label>

      <span className="font-mono text-[10px] text-zinc-400 hidden sm:inline uppercase">
        {strokeColor}
      </span>
    </footer>
  );
}
