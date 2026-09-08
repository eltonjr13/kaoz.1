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
  Ratio,
  Pencil,
  Eye,
  Sliders,
} from 'lucide-react';
import {
  ASPECT_RATIO_PRESETS,
  type BackgroundLayer,
  type GenerationHistoryItem,
  type SketchAspectRatio,
  type SketchLayer,
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

export function SketchDashboard() {
  const [project, setProject] = useState<SketchProjectData>(DEFAULT_PROJECT);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'generation' | 'copy' | 'attachments' | 'layers' | 'versions'>('generation');
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Canvas drawing controls
  const [activeTool, setActiveTool] = useState<'brush' | 'box' | 'eraser' | 'select'>('brush');
  const [strokeColor, setStrokeColor] = useState('#6366f1');
  const [strokeSize, setStrokeSize] = useState(6);
  const [boxLabel, setBoxLabel] = useState('Produto');

  // Generation status
  const [isGeneratingFlow, setIsGeneratingFlow] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Local storage persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem('kaoz1:sketch:active-project');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id && parsed.layers) {
          setProject(parsed);
        }
      }
    } catch {
      // Ignorar erro silencioso
    }
  }, []);

  const handleUpdateProject = (updater: (prev: SketchProjectData) => SketchProjectData) => {
    setProject((prev) => {
      const next = updater(prev);
      const updated = { ...next, updatedAt: new Date().toISOString() };
      try {
        localStorage.setItem('kaoz1:sketch:active-project', JSON.stringify(updated));
      } catch {
        // Ignorar falha de gravação de storage
      }
      return updated;
    });
  };

  const handleAspectRatioChange = (ratio: SketchAspectRatio) => {
    handleUpdateProject((prev) => ({ ...prev, aspectRatio: ratio }));
  };

  // Determine active reference image to pass to FlowProvider (1 reference only!)
  const getReferenceDataUrl = (): string | undefined => {
    const sketchLayer = project.layers.find((l) => l.type === 'sketch') as
      | import('@/types/sketch').SketchDrawingLayer
      | undefined;

    if (project.useSketchAsReference && sketchLayer && sketchLayer.paths.length > 0) {
      const preset = ASPECT_RATIO_PRESETS[project.aspectRatio] || ASPECT_RATIO_PRESETS['1:1'];
      return renderSketchOnlyDataUrl(sketchLayer.paths, preset.width, preset.height);
    }

    if (project.activeReferenceId) {
      const att = project.attachments.find((a) => a.id === project.activeReferenceId);
      if (att) return att.dataUrl;
    }

    return undefined;
  };

  // Trigger generation with FlowProvider via POST /api/flow/generate
  const handleGenerateFlowImage = async () => {
    if (!project.prompt.trim()) {
      setGenerationError('Informe uma descrição / prompt para a geração da imagem.');
      return;
    }

    setIsGeneratingFlow(true);
    setGenerationError(null);
    setGenerationSuccess(null);

    try {
      const refDataUrl = getReferenceDataUrl();
      const operation = refDataUrl ? 'reference' : 'simple';

      const res = await fetch('/api/flow/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'image',
          prompt: project.prompt,
          aspectRatio: project.aspectRatio,
          quantity: 1,
          operation,
          referenceImage: refDataUrl,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha na geração de imagem pelo FlowProvider.');
      }

      // Format media url from backend storage
      const rawPath = data.path || (data.paths && data.paths[0]);
      if (!rawPath) {
        throw new Error('Nenhum caminho de imagem retornado pelo FlowProvider.');
      }

      const mediaUrl = `/api/flow/media?path=${encodeURIComponent(rawPath)}`;

      // Update background layer with newly generated image
      handleUpdateProject((prev) => {
        const historyItem: GenerationHistoryItem = {
          id: `gen-${Date.now()}`,
          prompt: prev.prompt,
          imageUrl: mediaUrl,
          flowPath: rawPath,
          aspectRatio: prev.aspectRatio,
          createdAt: new Date().toISOString(),
        };

        const updatedLayers = prev.layers.map((l) => {
          if (l.type === 'background') {
            return {
              ...l,
              fillType: 'image',
              imageUrl: mediaUrl,
              flowMediaPath: rawPath,
            } as BackgroundLayer;
          }
          return l;
        });

        return {
          ...prev,
          layers: updatedLayers,
          generationHistory: [historyItem, ...prev.generationHistory],
        };
      });

      setGenerationSuccess('Arte de fundo gerada com sucesso e aplicada ao anúncio!');
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
      console.error('Erro ao exportar:', err);
      alert('Falha ao exportar imagem.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#07090e] text-white">
      {/* Top Header Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[#0d1017] px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <Pencil size={17} />
          </div>
          <div>
            <input
              type="text"
              value={project.title}
              onChange={(e) => handleUpdateProject((prev) => ({ ...prev, title: e.target.value }))}
              className="bg-transparent text-sm font-semibold text-white outline-none hover:border-b hover:border-zinc-600 focus:border-b focus:border-indigo-500"
            />
            <span className="block text-[10px] text-zinc-400">Estúdio de Anúncios Estáticos com IA</span>
          </div>
        </div>

        {/* Aspect Ratio Selector */}
        <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
          {(Object.keys(ASPECT_RATIO_PRESETS) as SketchAspectRatio[]).map((ratio) => {
            const isSelected = project.aspectRatio === ratio;
            return (
              <button
                key={ratio}
                type="button"
                onClick={() => handleAspectRatioChange(ratio)}
                title={ASPECT_RATIO_PRESETS[ratio].description}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                {ratio}
              </button>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('jpeg')}
            disabled={isExporting}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
          >
            <Download size={13} />
            <span>Exportar JPEG</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('png')}
            disabled={isExporting}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-indigo-500 transition-colors disabled:opacity-50"
          >
            {isExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            <span>Exportar PNG</span>
          </button>
        </div>
      </header>

      {/* Workspace Area: Canvas + Sidebar */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Central Canvas */}
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

        {/* Right Sidebar Control Panel */}
        <aside className="w-[360px] shrink-0 border-l border-[var(--line)] bg-[#0d1017] flex flex-col h-full overflow-hidden">
          {/* Sidebar Nav Tabs */}
          <div className="flex border-b border-[var(--line)] bg-[#090b10] px-2 py-1.5 gap-1">
            <button
              type="button"
              onClick={() => setActiveSidebarTab('generation')}
              title="Geração Visual e Prompt"
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                activeSidebarTab === 'generation'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <Sparkles size={13} />
              <span>Criação</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSidebarTab('copy')}
              title="Copywriting e Textos"
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                activeSidebarTab === 'copy'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <FileText size={13} />
              <span>Copy</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSidebarTab('attachments')}
              title="Múltiplos Anexos de Imagens"
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                activeSidebarTab === 'attachments'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <ImageIcon size={13} />
              <span>Anexos</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSidebarTab('layers')}
              title="Gerenciador de Camadas"
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                activeSidebarTab === 'layers'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <Layers size={13} />
              <span>Camadas</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSidebarTab('versions')}
              title="Versões e Snapshots"
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                activeSidebarTab === 'versions'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <History size={13} />
              <span>Versões</span>
            </button>
          </div>

          {/* Sidebar Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {activeSidebarTab === 'generation' && (
              <div className="flex flex-col gap-4 p-4 text-xs">
                <div className="border-b border-[var(--line)] pb-3">
                  <h3 className="text-sm font-semibold text-white">Geração Visual (FlowProvider)</h3>
                  <p className="text-[11px] text-zinc-400">
                    Crie a arte de fundo combinando descrição em texto com seu esboço ou anexo de referência.
                  </p>
                </div>

                {/* Prompt Description */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-zinc-300">
                    Descrição Visual do Anúncio (Prompt) *
                  </label>
                  <textarea
                    rows={4}
                    value={project.prompt}
                    onChange={(e) => handleUpdateProject((prev) => ({ ...prev, prompt: e.target.value }))}
                    placeholder="Descreva a cena, iluminação, produto e estética comercial..."
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Reference Conditioning Mode */}
                <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-[#10131c] p-3">
                  <span className="text-[11px] font-medium text-zinc-300">
                    Condicionamento de Referência
                  </span>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                      <input
                        type="radio"
                        name="refMode"
                        checked={project.useSketchAsReference}
                        onChange={() =>
                          handleUpdateProject((prev) => ({
                            ...prev,
                            useSketchAsReference: true,
                            activeReferenceId: undefined,
                          }))
                        }
                        className="accent-indigo-500"
                      />
                      <span>Usar Esboço do Canvas como Referência Visual</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                      <input
                        type="radio"
                        name="refMode"
                        checked={!project.useSketchAsReference && Boolean(project.activeReferenceId)}
                        onChange={() =>
                          handleUpdateProject((prev) => {
                            const firstRef = prev.attachments.find((a) => a.role === 'reference') || prev.attachments[0];
                            return {
                              ...prev,
                              useSketchAsReference: false,
                              activeReferenceId: firstRef?.id,
                            };
                          })
                        }
                        disabled={project.attachments.length === 0}
                        className="accent-indigo-500 disabled:opacity-40"
                      />
                      <span>
                        Usar Imagem Anexada de Referência {project.attachments.length === 0 && '(Nenhum anexo)'}
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                      <input
                        type="radio"
                        name="refMode"
                        checked={!project.useSketchAsReference && !project.activeReferenceId}
                        onChange={() =>
                          handleUpdateProject((prev) => ({
                            ...prev,
                            useSketchAsReference: false,
                            activeReferenceId: undefined,
                          }))
                        }
                        className="accent-indigo-500"
                      />
                      <span>Geração Direta (Sem imagem de referência)</span>
                    </label>
                  </div>

                  <p className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-800">
                    O FlowProvider aceita exatamente 1 referência visual por requisição.
                  </p>
                </div>

                {/* Feedback status */}
                {generationError && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5 text-rose-300 text-[11px]">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{generationError}</span>
                  </div>
                )}

                {generationSuccess && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-emerald-300 text-[11px]">
                    <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                    <span>{generationSuccess}</span>
                  </div>
                )}

                {/* Generate Button */}
                <button
                  type="button"
                  onClick={handleGenerateFlowImage}
                  disabled={isGeneratingFlow}
                  className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  {isGeneratingFlow ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Gerando arte no FlowProvider...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Gerar Arte de Fundo</span>
                    </>
                  )}
                </button>

                {/* Generation History Thumbnails */}
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
                            handleUpdateProject((prev) => ({
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
            )}

            {activeSidebarTab === 'copy' && (
              <SketchCopyEditor
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
              />
            )}

            {activeSidebarTab === 'attachments' && (
              <SketchAttachmentsPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                onSelectLayer={setSelectedLayerId}
              />
            )}

            {activeSidebarTab === 'layers' && (
              <SketchLayersPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
              />
            )}

            {activeSidebarTab === 'versions' && (
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
