"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Pencil,
  Sparkles,
  FolderOpen,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import {
  type FlowSupportedAspectRatio,
  type SketchAttachment,
  type SketchJobData,
  type SketchLayer,
  type SketchPath,
  type SketchProjectData,
  type SketchReferenceRole,
  type SketchSimpleOrder,
  type SketchChangeIntent,
  type BackgroundLayer,
  CANVAS_ASPECT_RATIO_PRESETS,
} from '@/types/sketch';
import { isJobActive } from '@/lib/sketch/sketch-job-state';
import { SketchSaveCoordinator, type SaveStatus } from '@/lib/sketch/sketch-save-coordinator';
import { createCleanProject } from '@/lib/sketch/sketch-project-defaults';
import { renderSketchOnlyDataUrl } from '@/lib/sketch/sketch-exporter';
import { SketchPromptInput } from './sketch-prompt-input';
import { SketchAttachmentBar } from './sketch-attachment-bar';
import { SketchFormatSelector } from './sketch-format-selector';
import { SketchDrawModal } from './sketch-draw-modal';
import { SketchProgressView } from './sketch-progress-view';
import { SketchResultView } from './sketch-result-view';
import { SketchProjectsModal } from './sketch-projects-modal';

type FlowState = 'input' | 'generating' | 'result';

function SaveStatusBadge({
  status,
  savedTime,
  error,
  onRetry,
}: {
  status: SaveStatus;
  savedTime: string;
  error?: string | null;
  onRetry: () => void;
}) {
  if (status === 'saving') {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
        <Loader2 size={12} className="animate-spin" />
        <span>Salvando...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-rose-400" title={error || undefined}>
        <AlertCircle size={12} />
        <span>Falha ao salvar</span>
        <button type="button" onClick={onRetry} className="underline hover:text-rose-300 font-medium">
          Tentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      <CheckCircle2 size={12} className="text-emerald-500" />
      <span>Salvo {savedTime ? `(${savedTime})` : ''}</span>
    </div>
  );
}

function SketchSingleFlowHeader({
  projectTitle,
  saveStatus,
  savedTime,
  saveError,
  onRetrySave,
  onOpenHistory,
  onNewProject,
  disabled,
}: {
  projectTitle: string;
  saveStatus: SaveStatus;
  savedTime: string;
  saveError: string | null;
  onRetrySave: () => void;
  onOpenHistory: () => void;
  onNewProject: () => void;
  disabled?: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/80 px-6 py-3.5 backdrop-blur-md sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
          <Pencil size={15} />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight text-white">Sketch</h1>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              Kaoz.1
            </span>
          </div>
          <span className="text-[11px] text-zinc-500 truncate max-w-[220px]">
            {projectTitle || 'Novo Anúncio'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SaveStatusBadge
          status={saveStatus}
          savedTime={savedTime}
          error={saveError}
          onRetry={onRetrySave}
        />

        <div className="h-4 w-px bg-zinc-800" />

        <button
          type="button"
          disabled={disabled}
          onClick={onOpenHistory}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white transition-all disabled:opacity-50"
          title="Histórico de projetos"
        >
          <FolderOpen size={13} className="text-zinc-400" />
          <span>Projetos</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onNewProject}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/30 hover:bg-indigo-500 transition-all disabled:opacity-50"
          title="Iniciar novo anúncio limpo"
        >
          <Plus size={13} />
          <span>Novo</span>
        </button>
      </div>
    </header>
  );
}

function SketchDrawTriggerChip({
  paths,
  thumbnail,
  onOpenModal,
  onClearSketch,
  disabled,
}: {
  paths: SketchPath[];
  thumbnail?: string;
  onOpenModal: () => void;
  onClearSketch: () => void;
  disabled?: boolean;
}) {
  const hasDrawing = paths.length > 0;

  if (hasDrawing) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          {thumbnail ? (
            <div className="h-10 w-10 overflow-hidden rounded-lg border border-indigo-500/30 bg-white">
              <img src={thumbnail} alt="Esboço" className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400">
              <Pencil size={18} />
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-indigo-200">Esboço Ativo</span>
            <span className="text-[11px] text-zinc-400">
              {paths.length} traço{paths.length > 1 ? 's' : ''} como guia visual
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onOpenModal}
            className="rounded-lg bg-indigo-600/30 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-600/50 transition-colors disabled:opacity-50"
          >
            Editar
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onClearSketch}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-rose-400 transition-colors disabled:opacity-50"
            title="Remover esboço"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpenModal}
      className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/80 hover:text-white transition-all disabled:opacity-50"
    >
      <Pencil size={14} className="text-indigo-400" />
      <span>Desenhar layout opcional (Sketch)</span>
    </button>
  );
}

function syncOrderFromProject(
  project: SketchProjectData,
  sketchPaths: SketchPath[],
  sketchThumbnail?: string
): SketchProjectData {
  const selectedReferences = project.attachments.map((att) => ({
    attachmentId: att.id,
    role: (att.role as SketchReferenceRole) || 'product',
    dataUrl: att.dataUrl,
    name: att.name,
    filePath: att.filePath,
  }));

  const hasDrawing = sketchPaths.length > 0;
  const sketchDrawing = hasDrawing
    ? { paths: sketchPaths, dataUrl: sketchThumbnail, hasDrawing: true }
    : undefined;

  const currentOrder: SketchSimpleOrder = {
    schemaVersion: 1,
    version: '1.0.0',
    id: project.currentOrder?.id || `order-${project.id}-${Date.now()}`,
    prompt: project.prompt,
    aspectRatio: project.aspectRatio,
    canvasAspectRatio: project.canvasAspectRatio,
    canvasDimensions: project.canvasDimensions,
    selectedReferences,
    sketchDrawing,
    createdAt: project.currentOrder?.createdAt || new Date().toISOString(),
  };

  return {
    ...project,
    currentOrder,
    useSketchAsReference: hasDrawing,
  };
}

function extractPathsFromProject(project: SketchProjectData): SketchPath[] {
  const sketchLayer = project.layers.find((l) => l.type === 'sketch');
  if (sketchLayer && 'paths' in sketchLayer && Array.isArray(sketchLayer.paths)) {
    return sketchLayer.paths as SketchPath[];
  }
  return [];
}

function getResultImageUrl(project: SketchProjectData): string | undefined {
  const results = project.creativeResults;
  if (!results || results.length === 0) return undefined;
  const active = results.find((r) => r.id === project.activeResultId) || results[results.length - 1];
  return active?.finalAsset?.imageUrl;
}

function getBackgroundLayerImageUrl(project: SketchProjectData): string {
  for (const layer of project.layers) {
    if (layer.type === 'background') {
      const bg = layer as BackgroundLayer;
      return bg.imageUrl || '';
    }
  }
  return '';
}

function resolveActiveImageUrl(
  project: SketchProjectData,
  job: SketchJobData | null
): string {
  const resultUrl = getResultImageUrl(project);
  if (resultUrl) return resultUrl;

  if (job?.result?.imageUrl) {
    return job.result.imageUrl;
  }

  return getBackgroundLayerImageUrl(project);
}

function resolveReferenceDataUrl(
  paths: SketchPath[],
  thumbnail?: string
): string | undefined {
  if (paths.length === 0) return undefined;
  return thumbnail || renderSketchOnlyDataUrl(paths, 1080, 1080);
}

function InputFlowView({
  project,
  sketchPaths,
  sketchThumbnail,
  isGenerating,
  generationError,
  onClearError,
  onPromptChange,
  onFormatChange,
  onAddAttachment,
  onUpdateAttachmentRole,
  onRemoveAttachment,
  onOpenDrawModal,
  onClearSketch,
  onGenerate,
}: {
  project: SketchProjectData;
  sketchPaths: SketchPath[];
  sketchThumbnail?: string;
  isGenerating: boolean;
  generationError: string | null;
  onClearError: () => void;
  onPromptChange: (prompt: string) => void;
  onFormatChange: (aspectRatio: FlowSupportedAspectRatio) => void;
  onAddAttachment: (att: SketchAttachment) => void;
  onUpdateAttachmentRole: (id: string, role: SketchReferenceRole) => void;
  onRemoveAttachment: (id: string) => void;
  onOpenDrawModal: () => void;
  onClearSketch: () => void;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 w-full py-4">
      {generationError && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="text-rose-400 shrink-0" />
            <span>{generationError}</span>
          </div>
          <button type="button" onClick={onClearError} className="text-rose-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      <SketchPromptInput
        prompt={project.prompt}
        onChange={onPromptChange}
        onGenerate={onGenerate}
        isGenerating={isGenerating}
      />

      <SketchAttachmentBar
        attachments={project.attachments}
        onAddAttachment={onAddAttachment}
        onUpdateRole={onUpdateAttachmentRole}
        onRemoveAttachment={onRemoveAttachment}
        disabled={isGenerating}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <SketchDrawTriggerChip
          paths={sketchPaths}
          thumbnail={sketchThumbnail}
          onOpenModal={onOpenDrawModal}
          onClearSketch={onClearSketch}
          disabled={isGenerating}
        />

        <SketchFormatSelector
          aspectRatio={project.aspectRatio}
          onChange={onFormatChange}
          disabled={isGenerating}
        />
      </div>

      <div className="pt-4 flex flex-col items-center">
        <button
          type="button"
          disabled={isGenerating || !project.prompt.trim()}
          onClick={onGenerate}
          className="flex items-center justify-center gap-2 w-full rounded-2xl bg-indigo-600 py-3.5 px-6 text-sm font-bold text-white shadow-xl shadow-indigo-600/30 hover:bg-indigo-500 hover:shadow-indigo-600/40 transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Sparkles size={16} />
          <span>Gerar criativo</span>
        </button>
        <span className="text-[11px] text-zinc-500 mt-2">
          Geração estática completa guiada por IA sem necessidade de diagramação manual
        </span>
      </div>
    </div>
  );
}

export function SketchSingleFlow() {
  const [project, setProject] = useState<SketchProjectData>(() => createCleanProject());
  const [flowState, setFlowState] = useState<FlowState>('input');

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [savedTime, setSavedTime] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [sketchPaths, setSketchPaths] = useState<SketchPath[]>([]);
  const [sketchThumbnail, setSketchThumbnail] = useState<string | undefined>(undefined);
  const [isDrawModalOpen, setIsDrawModalOpen] = useState(false);
  const [isProjectsModalOpen, setIsProjectsModalOpen] = useState(false);

  const [activeJob, setActiveJob] = useState<SketchJobData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const coordinatorRef = useRef<SketchSaveCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new SketchSaveCoordinator(
      async (toSave) => {
        const res = await fetch(`/api/sketch/projects/${toSave.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toSave),
        });
        if (!res.ok) throw new Error('Falha ao salvar projeto');
        const data = await res.json();
        return Boolean(data.success);
      },
      {
        onStatusChange: (s, err) => {
          setSaveStatus(s);
          if (err !== undefined) setSaveError(err);
        },
      }
    );
  }
  const coordinator = coordinatorRef.current;

  const registerProjectChange = useCallback(
    (updated: SketchProjectData, paths = sketchPaths, thumb = sketchThumbnail) => {
      const withOrder = syncOrderFromProject(updated, paths, thumb);
      setProject(withOrder);
      coordinator.registerEdit(withOrder, 700);
      setSavedTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    },
    [coordinator, sketchPaths, sketchThumbnail]
  );

  const handlePromptChange = (prompt: string) => registerProjectChange({ ...project, prompt });

  const handleFormatChange = (aspectRatio: FlowSupportedAspectRatio) => {
    const preset = CANVAS_ASPECT_RATIO_PRESETS[aspectRatio] || CANVAS_ASPECT_RATIO_PRESETS['1:1'];
    registerProjectChange({
      ...project,
      aspectRatio,
      canvasAspectRatio: aspectRatio,
      canvasDimensions: { width: preset.width, height: preset.height, unit: 'px' },
    });
  };

  const handleAddAttachment = (att: SketchAttachment) => {
    registerProjectChange({ ...project, attachments: [...project.attachments, att] });
  };

  const handleUpdateAttachmentRole = (id: string, role: SketchReferenceRole) => {
    const updated = project.attachments.map((a) => (a.id === id ? { ...a, role } : a));
    registerProjectChange({ ...project, attachments: updated });
  };

  const handleRemoveAttachment = (id: string) => {
    const updated = project.attachments.filter((a) => a.id !== id);
    registerProjectChange({ ...project, attachments: updated });
  };

  const handleApplySketch = (paths: SketchPath[], thumbnail?: string) => {
    setSketchPaths(paths);
    setSketchThumbnail(thumbnail);
    setIsDrawModalOpen(false);

    const filteredLayers = project.layers.filter((l) => l.type !== 'sketch');
    const sketchLayer: SketchLayer = {
      id: 'layer-sketch-root',
      name: 'Esboço de Composição',
      type: 'sketch',
      paths,
      visible: true,
      opacity: 0.85,
      elementKind: 'annotation',
      includeInFinalExport: false,
    };
    const updatedLayers = paths.length > 0 ? [...filteredLayers, sketchLayer] : filteredLayers;
    registerProjectChange({ ...project, layers: updatedLayers }, paths, thumbnail);
  };

  const handleJobFinished = useCallback(
    async (status: string, jobError?: string) => {
      setIsGenerating(false);
      if (status === 'completed') {
        try {
          const pRes = await fetch(`/api/sketch/projects/${project.id}`);
          const pData = await pRes.json();
          if (pData.success && pData.project) {
            setProject(pData.project);
          }
        } catch {
          // Mantém estado atual se falhar fetch
        }
        setFlowState('result');
      } else if (status === 'failed') {
        setGenerationError(jobError || 'Falha na geração do anúncio');
        setFlowState('input');
      }
    },
    [project.id]
  );

  const pollActiveJob = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(`/api/sketch/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.job) {
          const currentJob: SketchJobData = data.job;
          setActiveJob(currentJob);
          if (!isJobActive(currentJob.status)) {
            await handleJobFinished(currentJob.status, currentJob.error);
          }
        }
      } catch {
        // Ignora tick de erro transitório
      }
    },
    [handleJobFinished]
  );

  useEffect(() => {
    if (!isGenerating || !activeJob?.id) return;
    const interval = setInterval(() => pollActiveJob(activeJob.id), 1200);
    return () => clearInterval(interval);
  }, [isGenerating, activeJob?.id, pollActiveJob]);

  const handleGenerate = async (customIntent?: SketchChangeIntent['type'], customFeedback?: string) => {
    if (!project.prompt.trim()) {
      setGenerationError('Descreva seu anúncio antes de gerar.');
      return;
    }
    setGenerationError(null);
    setIsGenerating(true);
    setFlowState('generating');

    try {
      if (coordinator.isDirty()) {
        await coordinator.flushSave();
      }

      const refDataUrl = resolveReferenceDataUrl(sketchPaths, sketchThumbnail);
      const res = await fetch('/api/sketch/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          idempotencyToken: `single-${project.id}-${Date.now()}`,
          referenceDataUrl: refDataUrl,
          changeIntent: customIntent ? { type: customIntent, userFeedback: customFeedback || '' } : undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.job) {
        setActiveJob(data.job);
      } else {
        setIsGenerating(false);
        setGenerationError(data.error || 'Não foi possível iniciar a geração.');
        setFlowState('input');
      }
    } catch (err: unknown) {
      setIsGenerating(false);
      setGenerationError(err instanceof Error ? err.message : 'Erro de conexão');
      setFlowState('input');
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob?.id) return;
    try {
      await fetch(`/api/sketch/jobs/${activeJob.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      setIsGenerating(false);
      setFlowState('input');
    } catch {
      // Ignora erro
    }
  };

  const handleDownload = () => {
    const imageUrl = resolveActiveImageUrl(project, activeJob);
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `sketch-ad-${project.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleNewProject = () => {
    coordinator.reset(0);
    setProject(createCleanProject());
    setSketchPaths([]);
    setSketchThumbnail(undefined);
    setFlowState('input');
    setGenerationError(null);
  };

  const handleOpenProjectFromModal = async (projectId: string) => {
    try {
      const res = await fetch(`/api/sketch/projects/${projectId}`);
      const data = await res.json();
      if (data.success && data.project) {
        coordinator.reset(0);
        const loaded: SketchProjectData = data.project;
        setProject(loaded);
        const paths = extractPathsFromProject(loaded);
        setSketchPaths(paths);
        setSketchThumbnail(paths.length > 0 ? renderSketchOnlyDataUrl(paths, 240, 240) : undefined);
        setIsProjectsModalOpen(false);
        setFlowState(loaded.creativeResults?.length ? 'result' : 'input');
      }
    } catch {
      setSaveError('Erro ao abrir projeto.');
    }
  };

  const activeResult = project.creativeResults?.find((r) => r.id === project.activeResultId) ||
    (project.creativeResults && project.creativeResults[project.creativeResults.length - 1]);
  const activeImageUrl = resolveActiveImageUrl(project, activeJob);

  return (
    <div className="flex flex-col min-h-screen bg-[#07090e] text-zinc-100 selection:bg-indigo-500 selection:text-white">
      <SketchSingleFlowHeader
        projectTitle={project.title}
        saveStatus={saveStatus}
        savedTime={savedTime}
        saveError={saveError}
        onRetrySave={() => coordinator.flushSave()}
        onOpenHistory={() => setIsProjectsModalOpen(true)}
        onNewProject={handleNewProject}
        disabled={isGenerating}
      />

      <main className="flex-1 flex flex-col items-center justify-center p-6 max-w-3xl w-full mx-auto">
        {flowState === 'generating' && (
          <div className="w-full">
            <SketchProgressView
              job={activeJob}
              error={generationError}
              onCancel={handleCancelJob}
              onRetry={() => handleGenerate()}
            />
          </div>
        )}

        {flowState === 'result' && (
          <SketchResultView
            project={project}
            activeResult={activeResult}
            imageUrl={activeImageUrl}
            aspectRatio={project.aspectRatio}
            onDownload={handleDownload}
            onAnotherIdea={() => handleGenerate('new_concept', 'Outra ideia')}
            onApplyAdjustment={(adj) => handleGenerate('refine_text', adj)}
            onBackToEdit={() => setFlowState('input')}
            isGenerating={isGenerating}
          />
        )}

        {flowState === 'input' && (
          <InputFlowView
            project={project}
            sketchPaths={sketchPaths}
            sketchThumbnail={sketchThumbnail}
            isGenerating={isGenerating}
            generationError={generationError}
            onClearError={() => setGenerationError(null)}
            onPromptChange={handlePromptChange}
            onFormatChange={handleFormatChange}
            onAddAttachment={handleAddAttachment}
            onUpdateAttachmentRole={handleUpdateAttachmentRole}
            onRemoveAttachment={handleRemoveAttachment}
            onOpenDrawModal={() => setIsDrawModalOpen(true)}
            onClearSketch={() => handleApplySketch([], undefined)}
            onGenerate={() => handleGenerate()}
          />
        )}
      </main>

      <SketchDrawModal
        isOpen={isDrawModalOpen}
        initialPaths={sketchPaths}
        onApply={handleApplySketch}
        onCancel={() => setIsDrawModalOpen(false)}
      />

      <SketchProjectsModal
        isOpen={isProjectsModalOpen}
        activeProjectId={project.id}
        onClose={() => setIsProjectsModalOpen(false)}
        onOpenProject={handleOpenProjectFromModal}
        onCreateNewProject={async (title, ratio) => {
          setProject(createCleanProject({ title, aspectRatio: ratio }));
          setSketchPaths([]);
          setSketchThumbnail(undefined);
          setIsProjectsModalOpen(false);
          setFlowState('input');
        }}
        onRenameProject={async () => {}}
        onDeleteProject={async () => {}}
      />
    </div>
  );
}
