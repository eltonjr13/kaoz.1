"use client";

import React from 'react';

interface CanvasLateralBarProps {
  strokeSize: number;
  setStrokeSize: (size: number) => void;
  strokeColor: string;
  isCleanPreview: boolean;
}

const PRESET_SIZES = [2, 4, 8, 14, 24, 36];

export function CanvasLateralBar({
  strokeSize,
  setStrokeSize,
  strokeColor,
  isCleanPreview,
}: CanvasLateralBarProps) {
  if (isCleanPreview) return null;

  return (
    <aside
      aria-label="Espessura do traço"
      className="absolute left-3 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2.5 rounded-2xl border border-zinc-800/90 bg-[#0d1017]/95 p-2 shadow-2xl backdrop-blur-md"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Traço
      </span>

      {/* Visual dot preview */}
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900">
        <div
          className="rounded-full transition-all"
          style={{
            width: Math.min(32, Math.max(3, strokeSize)),
            height: Math.min(32, Math.max(3, strokeSize)),
            backgroundColor: strokeColor,
          }}
        />
      </div>

      <span className="font-mono text-[10px] text-zinc-300">
        {strokeSize}px
      </span>

      {/* Preset buttons */}
      <div className="flex flex-col items-center gap-1">
        {PRESET_SIZES.map((size) => {
          const isSelected = strokeSize === size;
          return (
            <button
              key={size}
              type="button"
              onClick={() => setStrokeSize(size)}
              title={`${size}px`}
              className={`flex h-6 w-6 items-center justify-center rounded-lg transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: Math.max(2, size / 2.5), height: Math.max(2, size / 2.5) }}
              />
            </button>
          );
        })}
      </div>

      {/* Fine-tune vertical slider */}
      <input
        type="range"
        min={1}
        max={48}
        value={strokeSize}
        onChange={(e) => setStrokeSize(Number(e.target.value))}
        title={`Espessura: ${strokeSize}px`}
        className="h-20 w-2 accent-indigo-500 [writing-mode:vertical-lr] [direction:rtl] cursor-pointer"
      />
    </aside>
  );
}
