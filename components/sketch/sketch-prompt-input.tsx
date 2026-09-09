"use client";

import React, { useRef, useEffect } from 'react';
import { X, Sparkles, CornerDownLeft } from 'lucide-react';

export interface SketchPromptInputProps {
  prompt: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
}

export function SketchPromptInput({
  prompt,
  onChange,
  onGenerate,
  isGenerating = false,
  disabled = false,
}: SketchPromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(100, el.scrollHeight)}px`;
  }, [prompt]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled && !isGenerating && prompt.trim()) {
        onGenerate();
      }
    }
  };

  return (
    <div className="relative flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 shadow-xl transition-all duration-200 focus-within:border-indigo-500/80 focus-within:ring-2 focus-within:ring-indigo-500/20 backdrop-blur-sm">
      <div className="flex items-center justify-between pb-2 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5 font-medium text-zinc-300">
          <Sparkles size={14} className="text-indigo-400" />
          Descreva seu anúncio
        </span>
        {prompt.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled || isGenerating}
            className="flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
            title="Limpar texto"
          >
            <X size={12} />
            <span>Limpar</span>
          </button>
        )}
      </div>

      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || isGenerating}
        placeholder="Ex: Tênis esportivo para corrida urbana com amortecimento duplo, oferta especial de 30% OFF e frete grátis..."
        rows={3}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-100 placeholder-zinc-500 outline-none disabled:opacity-50"
      />

      <div className="flex items-center justify-between pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/60 mt-2">
        <span className="flex items-center gap-1 text-zinc-500">
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">Ctrl</kbd>
          <span>+</span>
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">Enter</kbd>
          <span className="ml-1 text-zinc-500">para gerar</span>
        </span>
        <span>{prompt.length} caracteres</span>
      </div>
    </div>
  );
}
