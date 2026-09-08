"use client";

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Download,
  Layers,
  FileText,
  Image as ImageIcon,
  History,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Pencil,
} from 'lucide-react';
import {
  ASPECT_RATIO_PRESETS,
  type BackgroundLayer,
  type GenerationHistoryItem,
  type SketchAspectRatio,
  type SketchProjectData,
  type TextLayer,
} from '@/types/sketch';
import { SketchCanvas } from './sketch-canvas';
import { SketchCopyEditor } from './sketch-copy-editor';
import { SketchAttachmentsPanel } from './sketch-attachments-panel';
import { SketchLayersPanel } from './sketch-layers-panel';
import { SketchVersionManager } from './sketch-version-manager';
import { downloadComposition, renderSketchOnlyDataUrl } from '@/lib/sketch/sketch-exporter';

const DEFAULT_PROJECT: SketchProjectData = {
  id: 'sketch-default-project',
  title: 'Novo Anúncio Estático',
  description: 'Composição de anúncio criada no Kaoz.1 Sketch',
  aspectRatio: '1:1',
  prompt: 'Modern clean commercial ad photo, vibrant product lighting, aesthetic studio setup, sharp focus.',
  useSketchAsReference: true,
  attachments: [],
  copy: {
    headline: 'O Futuro Chegou Hoje',
    subheadline: 'Descubra a tecnologia que transforma sua rotina com qualidade premium.',
    cta: 'Garanta o Seu',
    badge: 'Lançamento Exclusivo',
  },
  layers: [
    {
      id: 'layer-bg-root',
      name: 'Fundo da Arte',
      type: 'background',
      fillType: 'color',
      color: '#0d1117',
      visible: true,
      opacity: 1,
    } as BackgroundLayer,
    {
      id: 'layer-sketch-root',
      name: 'Esboço de Composição',
      type: 'sketch',
      paths: [],
      visible: true,
      opacity: 0.85,
    },
    {
      id: 'layer-text-badge',
      name: 'Selo (Badge)',
      type: 'text',
      role: 'badge',
      text: 'LANÇAMENTO EXCLUSIVO',
      x: 8,
      y: 8,
      width: 32,
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '700',
      color: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      backgroundPadding: 8,
      borderRadius: 6,
      textAlign: 'center',
      textTransform: 'uppercase',
      visible: true,
      opacity: 1,
    } as TextLayer,
    {
      id: 'layer-text-headline',
      name: 'Título (Headline)',
      type: 'text',
      role: 'headline',
      text: 'O Futuro Chegou Hoje',
      x: 8,
      y: 65,
      width: 84,
      fontSize: 42,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '800',
      color: '#ffffff',
      textAlign: 'left',
      visible: true,
      opacity: 1,
    } as TextLayer,
    {
      id: 'layer-text-subheadline',
      name: 'Subtítulo',
      type: 'text',
      role: 'subheadline',
      text: 'Descubra a tecnologia que transforma sua rotina com qualidade premium.',
      x: 8,
      y: 76,
      width: 84,
      fontSize: 20,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '500',
      color: '#cbd5e1',
      textAlign: 'left',
      visible: true,
      opacity: 1,
    } as TextLayer,
    {
      id: 'layer-text-cta',
      name: 'Botão CTA',
      type: 'text',
      role: 'cta',
      text: 'Garanta o Seu Agora',
      x: 8,
      y: 86,
      width: 40,
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '700',
      color: '#ffffff',
      backgroundColor: '#4f46e5',
      backgroundPadding: 12,
      borderRadius: 8,
      textAlign: 'center',
      visible: true,
      opacity: 1,
    } as TextLayer,
  ],
  generationHistory: [],
  updatedAt: new Date().toISOString(),
};

function resolveReferenceImage(project: SketchProjectData): string | undefined {
  const sketch = project.layers.find((l) => l.type === 'sketch') as
    | import('@/types/sketch').SketchDrawingLayer
    | undefined;

  if (project.useSketchAsReference && sketch && sketch.paths.length > 0) {
    const preset = ASPECT_RATIO_PRESETS[project.aspectRatio] || ASPECT_RATIO_PRESETS['1:1'];
    return renderSketchOnlyDataUrl(sketch.paths, preset.width, preset.height);
  }

  if (project.activeReferenceId) {
    const att = project.attachments.find((a) => a.id === project.activeReferenceId);
    if (att) return att.dataUrl;
  }

  return undefined;
}

function applyGeneratedMedia(
  prev: SketchProjectData,
  mediaUrl: string,
  rawPath: string
): SketchProjectData {
  const historyItem: GenerationHistoryItem = {
    id: `gen-${Date.now()}`,
    prompt: prev.prompt,
    imageUrl: mediaUrl,
    flowPath: rawPath,
    aspectRatio: prev.aspectRatio,
    createdAt: new Date().toISOString(),
  };

  const layers = prev.layers.map((l) => {
    if (l.type !== 'background') return l;
    return {
      ...l,
      fillType: 'image',
      imageUrl: mediaUrl,
      flowMediaPath: rawPath,
    } as BackgroundLayer;
  });

  return {
    ...prev,
    layers,
    generationHistory: [historyItem, ...prev.generationHistory],
  };
}

async function executeFlowApiCall(
  prompt: string,
  aspectRatio: SketchAspectRatio,
  refDataUrl?: string
): Promise<string> {
  const res = await fetch('/api/flow/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'image',
      prompt,
      aspectRatio,
      quantity: 1,
      operation: refDataUrl ? 'reference' : 'simple',
      referenceImage: refDataUrl,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Falha na geração pelo FlowProvider.');
  }

  const rawPath = data.path || (data.paths && data.paths[0]);
  if (!rawPath) throw new Error('Caminho não retornado pelo FlowProvider.');
  return rawPath;
}

function SketchTopBar({
  title,
  aspectRatio,
  isExporting,
  onUpdateTitle,
  onUpdateRatio,
  onExport,
}: {
  title: string;
  aspectRatio: SketchAspectRatio;
  isExporting: boolean;
  onUpdateTitle: (title: string) => void;
  onUpdateRatio: (ratio: SketchAspectRatio) => void;
  onExport: (format: 'png' | 'jpeg') => void;
}) {
  const ratios = Object.keys(ASPECT_RATIO_PRESETS) as SketchAspectRatio[];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[#0d1017] px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
          <Pencil size={17} />
        </div>
        <div>
          <input
            type="text"
            value={title}
            onChange={(e) => onUpdateTitle(e.target.value)}
            className="bg-transparent text-sm font-semibold text-white outline-none hover:border-b hover:border-zinc-600 focus:border-b focus:border-indigo-500"
          />
          <span className="block text-[10px] text-zinc-400">Estúdio de Anúncios Estáticos com IA</span>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
        {ratios.map((ratio) => (
          <button
            key={ratio}
            type="button"
            onClick={() => onUpdateRatio(ratio)}
            title={ASPECT_RATIO_PRESETS[ratio].description}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              aspectRatio === ratio
                ? 'bg-indigo-600 text-white shadow'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            {ratio}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onExport('jpeg')}
          disabled={isExporting}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
        >
          <Download size={13} />
          <span>Exportar JPEG</span>
        </button>
        <button
          type="button"
          onClick={() => onExport('png')}
          disabled={isExporting}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-indigo-500 transition-colors disabled:opacity-50"
        >
          {isExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          <span>Exportar PNG</span>
        </button>
      </div>
    </header>
  );
}

type TabKey = 'generation' | 'copy' | 'attachments' | 'layers' | 'versions';

function SidebarNavTabs({
  activeTab,
  onSelectTab,
}: {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string; icon: React.ComponentType<{ size: number }> }[] = [
    { key: 'generation', label: 'Criação', icon: Sparkles },
    { key: 'copy', label: 'Copy', icon: FileText },
    { key: 'attachments', label: 'Anexos', icon: ImageIcon },
    { key: 'layers', label: 'Camadas', icon: Layers },
    { key: 'versions', label: 'Versões', icon: History },
  ];

  return (
    <div className="flex border-b border-[var(--line)] bg-[#090b10] px-2 py-1.5 gap-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelectTab(tab.key)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium ${
              isActive ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <Icon size={13} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function GenerationPanel({
  project,
  isGenerating,
  error,
  success,
  onUpdateProject,
  onGenerate,
}: {
  project: SketchProjectData;
  isGenerating: boolean;
  error: string | null;
  success: string | null;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4 text-xs">
      <div className="border-b border-[var(--line)] pb-3">
        <h3 className="text-sm font-semibold text-white">Geração Visual (FlowProvider)</h3>
        <p className="text-[11px] text-zinc-400">
          Crie a arte de fundo combinando descrição em texto com seu esboço ou anexo.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-300">Descrição Visual (Prompt) *</label>
        <textarea
          rows={4}
          value={project.prompt}
          onChange={(e) => onUpdateProject((prev) => ({ ...prev, prompt: e.target.value }))}
          placeholder="Descreva o produto, estética, iluminação de estúdio..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-white outline-none"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-[#10131c] p-3">
        <span className="text-[11px] font-medium text-zinc-300">Condicionamento de Referência</span>
        <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
          <input
            type="radio"
            name="refMode"
            checked={project.useSketchAsReference}
            onChange={() =>
              onUpdateProject((prev) => ({ ...prev, useSketchAsReference: true, activeReferenceId: undefined }))
            }
            className="accent-indigo-500"
          />
          <span>Usar Esboço do Canvas como Referência</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
          <input
            type="radio"
            name="refMode"
            checked={!project.useSketchAsReference && Boolean(project.activeReferenceId)}
            onChange={() =>
              onUpdateProject((prev) => ({
                ...prev,
                useSketchAsReference: false,
                activeReferenceId: prev.attachments[0]?.id,
              }))
            }
            disabled={project.attachments.length === 0}
            className="accent-indigo-500 disabled:opacity-40"
          />
          <span>Usar Imagem Anexada de Referência</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
          <input
            type="radio"
            name="refMode"
            checked={!project.useSketchAsReference && !project.activeReferenceId}
            onChange={() =>
              onUpdateProject((prev) => ({ ...prev, useSketchAsReference: false, activeReferenceId: undefined }))
            }
            className="accent-indigo-500"
          />
          <span>Geração Direta (Sem imagem de referência)</span>
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5 text-rose-300 text-[11px]">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-emerald-300 text-[11px]">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating}
        className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all disabled:opacity-50"
      >
        {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        <span>{isGenerating ? 'Gerando arte no FlowProvider...' : 'Gerar Arte de Fundo'}</span>
      </button>

      {project.generationHistory.length > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t border-zinc-800">
          <span className="text-[11px] font-medium text-zinc-400">
            Gerações Anteriores ({project.generationHistory.length})
          </span>
          <div className="grid grid-cols-3 gap-2">
            {project.generationHistory.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onUpdateProject((prev) => ({
                    ...prev,
                    layers: prev.layers.map((l) =>
                      l.type === 'background'
                        ? ({ ...l, fillType: 'image', imageUrl: item.imageUrl, flowMediaPath: item.flowPath } as BackgroundLayer)
                        : l
                    ),
                  }));
                }}
                className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-800 hover:border-indigo-500"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt="Histórico" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SketchDashboard() {
  const [project, setProject] = useState<SketchProjectData>(DEFAULT_PROJECT);
  const [activeTab, setActiveTab] = useState<TabKey>('generation');
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState<'brush' | 'box' | 'eraser' | 'select'>('brush');
  const [strokeColor, setStrokeColor] = useState('#6366f1');
  const [strokeSize, setStrokeSize] = useState(6);
  const [boxLabel, setBoxLabel] = useState('Produto');

  const [isGeneratingFlow, setIsGeneratingFlow] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('kaoz1:sketch:active-project');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id && parsed?.layers) setProject(parsed);
      }
    } catch {
      // Ignorar
    }
  }, []);

  const handleUpdateProject = (updater: (prev: SketchProjectData) => SketchProjectData) => {
    setProject((prev) => {
      const next = updater(prev);
      const updated = { ...next, updatedAt: new Date().toISOString() };
      try {
        localStorage.setItem('kaoz1:sketch:active-project', JSON.stringify(updated));
      } catch {
        // Ignorar
      }
      return updated;
    });
  };

  const handleGenerateFlowImage = async () => {
    if (!project.prompt.trim()) {
      setGenerationError('Informe uma descrição / prompt.');
      return;
    }

    setIsGeneratingFlow(true);
    setGenerationError(null);
    setGenerationSuccess(null);

    try {
      const refDataUrl = resolveReferenceImage(project);
      const rawPath = await executeFlowApiCall(project.prompt, project.aspectRatio, refDataUrl);
      const mediaUrl = `/api/flow/media?path=${encodeURIComponent(rawPath)}`;
      handleUpdateProject((prev) => applyGeneratedMedia(prev, mediaUrl, rawPath));
      setGenerationSuccess('Arte de fundo gerada e aplicada com sucesso!');
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingFlow(false);
    }
  };

  const handleExport = async (format: 'png' | 'jpeg') => {
    setIsExporting(true);
    try {
      await downloadComposition(project, format);
    } catch (err) {
      alert('Falha ao exportar.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#07090e] text-white">
      <SketchTopBar
        title={project.title}
        aspectRatio={project.aspectRatio}
        isExporting={isExporting}
        onUpdateTitle={(title) => handleUpdateProject((prev) => ({ ...prev, title }))}
        onUpdateRatio={(ratio) => handleUpdateProject((prev) => ({ ...prev, aspectRatio: ratio }))}
        onExport={handleExport}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 h-full">
          <SketchCanvas
            project={project}
            onUpdateProject={handleUpdateProject}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            strokeColor={strokeColor}
            setStrokeColor={setStrokeColor}
            strokeSize={strokeSize}
            setStrokeSize={setStrokeSize}
            boxLabel={boxLabel}
            setBoxLabel={setBoxLabel}
          />
        </div>

        <aside className="w-[360px] shrink-0 border-l border-[var(--line)] bg-[#0d1017] flex flex-col h-full overflow-hidden">
          <SidebarNavTabs activeTab={activeTab} onSelectTab={setActiveTab} />

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'generation' && (
              <GenerationPanel
                project={project}
                isGenerating={isGeneratingFlow}
                error={generationError}
                success={generationSuccess}
                onUpdateProject={handleUpdateProject}
                onGenerate={handleGenerateFlowImage}
              />
            )}
            {activeTab === 'copy' && (
              <SketchCopyEditor
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
              />
            )}
            {activeTab === 'attachments' && (
              <SketchAttachmentsPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                onSelectLayer={setSelectedLayerId}
              />
            )}
            {activeTab === 'layers' && (
              <SketchLayersPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
              />
            )}
            {activeTab === 'versions' && (
              <SketchVersionManager
                project={project}
                onRestoreProject={(restored) => setProject(restored)}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
