"use client";

import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  CheckCircle2,
  Loader2,
  Maximize2,
  FileImage,
  Monitor,
  Globe,
} from 'lucide-react';
import type { ExportCompositionOptions, SketchProjectData } from '@/types/sketch';
import {
  downloadComposition,
  exportCompositionDataUrl,
  resolveCanvasDimensionPreset,
} from '@/lib/sketch/sketch-exporter';

interface SketchExportModalProps {
  isOpen: boolean;
  project: SketchProjectData;
  onClose: () => void;
}

function resolveTargetDimensions(
  project: SketchProjectData,
  scale: number
): { width: number; height: number; isUpscale: boolean } {
  const preset = resolveCanvasDimensionPreset(project);
  const width = Math.round(preset.width * scale);
  const height = Math.round(preset.height * scale);
  const isUpscale = scale > 1;
  return { width, height, isUpscale };
}

function FormatSelector({
  format,
  onChange,
}: {
  format: 'png' | 'jpeg';
  onChange: (f: 'png' | 'jpeg') => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-zinc-300">Formato de Exportação</span>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange('png')}
          className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
            format === 'png'
              ? 'border-indigo-500 bg-indigo-950/30 text-white shadow-sm'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-xs text-white">PNG</span>
            <span className="rounded bg-emerald-950/80 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
              Sem Perdas
            </span>
          </div>
          <p className="text-[10px] text-zinc-400">Preserva transparência e nitidez máxima nas cópias.</p>
        </button>

        <button
          type="button"
          onClick={() => onChange('jpeg')}
          className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
            format === 'jpeg'
              ? 'border-indigo-500 bg-indigo-950/30 text-white shadow-sm'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-xs text-white">JPEG</span>
            <span className="rounded bg-blue-950/80 px-1 py-0.5 text-[9px] font-medium text-blue-400">
              Web / Leve
            </span>
          </div>
          <p className="text-[10px] text-zinc-400">Fundo sólido com compressão otimizada para feed.</p>
        </button>
      </div>
    </div>
  );
}

function ScaleSelector({
  scale,
  onChange,
  project,
}: {
  scale: number;
  onChange: (s: number) => void;
  project: SketchProjectData;
}) {
  const preset = resolveCanvasDimensionPreset(project);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-zinc-300">Resolução e Escala</span>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: '0.5x', s: 0.5, desc: `${Math.round(preset.width * 0.5)}x${Math.round(preset.height * 0.5)}` },
          { label: '1x (Nativo)', s: 1, desc: `${preset.width}x${preset.height}` },
          { label: '2x (Alta)', s: 2, desc: `${preset.width * 2}x${preset.height * 2}` },
        ].map((item) => (
          <button
            key={item.s}
            type="button"
            onClick={() => onChange(item.s)}
            className={`flex flex-col items-center rounded-xl border py-2 px-1 text-center transition-all ${
              scale === item.s
                ? 'border-indigo-500 bg-indigo-950/40 text-white'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            <span className="font-semibold text-xs">{item.label}</span>
            <span className="text-[10px] text-zinc-500">{item.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function JpegOptionsBox({
  quality,
  bgColor,
  onQualityChange,
  onBgColorChange,
}: {
  quality: number;
  bgColor: string;
  onQualityChange: (q: number) => void;
  onBgColorChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-300">Qualidade JPEG ({Math.round(quality * 100)}%)</span>
        <input
          type="range"
          min={0.7}
          max={1}
          step={0.05}
          value={quality}
          onChange={(e) => onQualityChange(Number(e.target.value))}
          className="w-32 accent-indigo-500"
        />
      </div>

      <div className="flex items-center justify-between text-xs pt-1 border-t border-zinc-800/80">
        <div className="flex flex-col">
          <span className="font-medium text-zinc-300">Cor de Fundo Opaque</span>
          <span className="text-[10px] text-zinc-500">Evita manchas pretas em áreas transparentes</span>
        </div>
        <input
          type="color"
          value={bgColor}
          onChange={(e) => onBgColorChange(e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
        />
      </div>
    </div>
  );
}

function ExportPreviewCard({
  previewUrl,
  isLoading,
  targetWidth,
  targetHeight,
  isUpscale,
  ratioLabel,
}: {
  previewUrl: string | null;
  isLoading: boolean;
  targetWidth: number;
  targetHeight: number;
  isUpscale: boolean;
  ratioLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-300">Prévia Sem Guias</span>
        <span className="text-[11px] text-zinc-400 font-mono">
          {targetWidth} × {targetHeight} px ({ratioLabel})
        </span>
      </div>

      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-[#07090e]">
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 text-zinc-400">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
            <span className="text-[11px]">Gerando prévia final...</span>
          </div>
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Prévia Exportação" className="h-full w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-500">
            <FileImage size={28} />
            <span className="text-[11px]">Prévia indisponível</span>
          </div>
        )}

        {isUpscale && (
          <div className="absolute top-2 right-2 rounded bg-amber-500/90 px-2 py-0.5 text-[9px] font-semibold text-zinc-950 shadow">
            Ampliação 2x
          </div>
        )}
      </div>
    </div>
  );
}

function ExportInfoBadges({ isElectron }: { isElectron: boolean }) {
  const envLabel = isElectron ? 'Electron Desktop (Salvar Arquivo)' : 'Navegador Web (Download Direto)';

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 text-[11px] text-zinc-400">
      <div className="flex items-center gap-2 text-emerald-400">
        <CheckCircle2 size={13} className="shrink-0" />
        <span>Guias e anotações removidas da arte final</span>
      </div>
      <div className="flex items-center gap-2 text-zinc-300">
        {isElectron ? (
          <Monitor size={13} className="text-indigo-400 shrink-0" />
        ) : (
          <Globe size={13} className="text-indigo-400 shrink-0" />
        )}
        <span>Ambiente: {envLabel}</span>
      </div>
    </div>
  );
}

function ExportModalFooter({
  targetWidth,
  targetHeight,
  format,
  isElectron,
  isExporting,
  onClose,
  onDownload,
}: {
  targetWidth: number;
  targetHeight: number;
  format: string;
  isElectron: boolean;
  isExporting: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  const buttonLabel = isExporting ? 'Exportando...' : isElectron ? 'Salvar Anúncio' : 'Baixar Imagem';

  return (
    <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/30 p-4">
      <span className="text-xs text-zinc-400 font-mono">
        {targetWidth} × {targetHeight} px &bull; {format.toUpperCase()}
      </span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-zinc-700 bg-transparent px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={isExporting}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition-all disabled:opacity-50"
        >
          {isExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          <span>{buttonLabel}</span>
        </button>
      </div>
    </div>
  );
}

export function SketchExportModal({ isOpen, project, onClose }: SketchExportModalProps) {
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [scale, setScale] = useState<number>(1);
  const [quality, setQuality] = useState<number>(0.95);
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const isElectron = typeof window !== 'undefined' && Boolean(window.kaoz1Desktop?.saveFile);
  const ratio = project.canvasAspectRatio || project.aspectRatio || '1:1';
  const { width: targetWidth, height: targetHeight, isUpscale } = resolveTargetDimensions(project, scale);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoadingPreview(true);

    const opts: ExportCompositionOptions = {
      format,
      scale: 0.5,
      quality,
      excludeGuides: true,
      backgroundColorForJpeg: bgColor,
    };

    exportCompositionDataUrl(project, opts)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, project, format, quality, bgColor]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    setIsExporting(true);
    try {
      const opts: ExportCompositionOptions = {
        format,
        scale,
        quality,
        excludeGuides: true,
        backgroundColorForJpeg: bgColor,
      };
      await downloadComposition(project, opts);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d1017] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <Maximize2 size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Exportar Anúncio da Prancheta</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
          <ExportPreviewCard
            previewUrl={previewUrl}
            isLoading={isLoadingPreview}
            targetWidth={targetWidth}
            targetHeight={targetHeight}
            isUpscale={isUpscale}
            ratioLabel={ratio}
          />

          <div className="flex flex-col gap-4 text-xs">
            <FormatSelector format={format} onChange={setFormat} />
            <ScaleSelector scale={scale} onChange={setScale} project={project} />

            {format === 'jpeg' && (
              <JpegOptionsBox
                quality={quality}
                bgColor={bgColor}
                onQualityChange={setQuality}
                onBgColorChange={setBgColor}
              />
            )}

            <ExportInfoBadges isElectron={isElectron} />
          </div>
        </div>

        <ExportModalFooter
          targetWidth={targetWidth}
          targetHeight={targetHeight}
          format={format}
          isElectron={isElectron}
          isExporting={isExporting}
          onClose={onClose}
          onDownload={handleDownload}
        />
      </div>
    </div>
  );
}
