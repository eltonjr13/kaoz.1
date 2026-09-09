"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Pencil,
  FolderOpen,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Eye,
  Sparkles,
  Layers,
  FileText,
  Sliders,
  History,
  Image as ImageIcon,
  Plus,
} from 'lucide-react';
import {
  CANVAS_ASPECT_RATIO_PRESETS,
  resolveProviderAspectRatio,
  type SketchAspectRatio,
  type SketchCanvasAspectRatio,
  type SketchJobData,
  type SketchLayer,
  type SketchProjectData,
  type SketchTool,
} from '@/types/sketch';
import { isJobActive } from '@/lib/sketch/sketch-job-state';
import { SketchSaveCoordinator, type SaveStatus } from '@/lib/sketch/sketch-save-coordinator';
import { renderCompositeReferenceDataUrl } from '@/lib/sketch/sketch-exporter';
import { SketchCanvas } from './sketch-canvas';
import { SketchCopyEditor } from './sketch-copy-editor';
import { SketchAttachmentsPanel } from './sketch-attachments-panel';
import { SketchLayersPanel } from './sketch-layers-panel';
import { SketchVersionManager } from './sketch-version-manager';
import { SketchBriefingPanel } from './sketch-briefing-panel';
import { SketchPropertiesPanel } from './sketch-properties-panel';
import { SketchCompositePreviewPanel } from './sketch-composite-preview-panel';
import { SketchProjectsModal } from './sketch-projects-modal';
import { SketchExportModal } from './sketch-export-modal';

type LeftTab = 'briefing' | 'copy' | 'referencias';
type RightTab = 'propriedades' | 'camadas' | 'versoes';
type CenterViewMode = 'canvas' | 'preview';

function SaveStatusIndicator({
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
        <Loader2 size={13} className="animate-spin" />
        <span>Salvando...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-rose-400" title={error || undefined}>
        <AlertCircle size={13} />
        <span>Falha ao salvar</span>
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 underline hover:text-rose-300 font-medium"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
      <CheckCircle2 size={13} />
      <span>Salvo {savedTime ? `(${savedTime})` : ''}</span>
    </div>
  );
}

function SketchTopBar({
  title,
  canvasRatio,
  saveStatus,
  savedTime,
  saveError,
  centerView,
  isLeftOpen,
  isRightOpen,
  isExporting,
  onUpdateTitle,
  onUpdateRatio,
  onToggleLeft,
  onToggleRight,
  onChangeCenterView,
  onOpenProjectsModal,
  onRetrySave,
  onOpenExportModal,
  activeJob,
}: {
  title: string;
  canvasRatio: SketchCanvasAspectRatio;
  saveStatus: SaveStatus;
  savedTime: string;
  saveError?: string | null;
  centerView: CenterViewMode;
  isLeftOpen: boolean;
  isRightOpen: boolean;
  isExporting: boolean;
  onUpdateTitle: (title: string) => void;
  onUpdateRatio: (ratio: SketchCanvasAspectRatio) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onChangeCenterView: (view: CenterViewMode) => void;
  onOpenProjectsModal: () => void;
  onRetrySave: () => void;
  onOpenExportModal: () => void;
  activeJob?: SketchJobData | null;
}) {
  const quickRatios: SketchCanvasAspectRatio[] = ['1:1', '9:16', '16:9', '4:5'];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-[#0d1017] px-3 sm:px-4 text-xs min-w-0 overflow-x-auto gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        <button
          type="button"
          onClick={onToggleLeft}
          title={isLeftOpen ? 'Recolher painel esquerdo' : 'Expandir painel esquerdo'}
          className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          {isLeftOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>

        <button
          type="button"
          onClick={onOpenProjectsModal}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          title="Abrir ou gerenciar projetos"
        >
          <FolderOpen size={14} />
          <span className="hidden sm:inline">Projetos</span>
        </button>

        <div className="flex items-center gap-1.5 min-w-0">
          <input
            type="text"
            value={title}
            onChange={(e) => onUpdateTitle(e.target.value)}
            className="w-32 sm:w-48 md:w-60 truncate rounded-md bg-transparent px-1.5 py-0.5 font-semibold text-white hover:bg-zinc-800/60 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            title="Clique para renomear o projeto"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden lg:flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
          {quickRatios.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onUpdateRatio(r)}
              className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                canvasRatio === r
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
          <button
            type="button"
            onClick={() => onChangeCenterView('canvas')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              centerView === 'canvas'
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Pencil size={12} />
            <span>Prancheta</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeCenterView('preview')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              centerView === 'preview'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Sparkles size={12} />
            <span>Prévia Flow</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {activeJob && isJobActive(activeJob.status) && (
          <button
            type="button"
            onClick={() => onChangeCenterView('preview')}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-950/80 border border-indigo-500/40 px-2.5 py-1 text-[11px] text-indigo-200 hover:bg-indigo-900/60 transition-colors animate-pulse"
            title="Acompanhar geração do Flow na aba Prévia"
          >
            <Loader2 size={12} className="animate-spin text-indigo-400" />
            <span>Gerando no Flow ({activeJob.progressPercentage}%)</span>
          </button>
        )}

        <SaveStatusIndicator
          status={saveStatus}
          savedTime={savedTime}
          error={saveError}
          onRetry={onRetrySave}
        />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenExportModal}
            disabled={isExporting}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition-all disabled:opacity-50"
            title="Configurar dimensões, escala, qualidade e exportar anúncio"
          >
            {isExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            <span>Exportar...</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleRight}
          title={isRightOpen ? 'Recolher painel direito' : 'Expandir painel direito'}
          className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          {isRightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </header>
  );
}

function SketchEmptyState({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#07090e] text-zinc-300 p-6">
      <div className="flex flex-col items-center max-w-md text-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
          <Pencil size={32} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-bold text-white">Nenhum projeto encontrado</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Crie seu primeiro projeto para começar a desenhar rascunhos guiados por IA, adicionar
            briefing, copy e imagens de referência.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateProject}
          className="mt-2 flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all"
        >
          <Plus size={16} />
          <span>Criar Primeiro Anúncio</span>
        </button>
      </div>
    </div>
  );
}

function SketchLeftSidebar({
  isOpen,
  activeTab,
  project,
  selectedLayerId,
  onSelectTab,
  onUpdateProject,
  onSelectLayer,
}: {
  isOpen: boolean;
  activeTab: LeftTab;
  project: SketchProjectData;
  selectedLayerId: string | null;
  onSelectTab: (tab: LeftTab) => void;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onSelectLayer: (layerId: string | null) => void;
}) {
  if (!isOpen) return null;

  return (
    <aside className="w-80 shrink-0 border-r border-zinc-800 bg-[#0a0d14] flex flex-col h-full overflow-hidden">
      <div className="flex items-center border-b border-zinc-800 bg-[#0d1017] px-2 pt-2 text-xs font-medium">
        <button
          type="button"
          onClick={() => onSelectTab('briefing')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors ${
            activeTab === 'briefing'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <FileText size={13} />
          <span>Briefing</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('copy')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors ${
            activeTab === 'copy'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Pencil size={13} />
          <span>Copy</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('referencias')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors ${
            activeTab === 'referencias'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <ImageIcon size={13} />
          <span>Anexos</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'briefing' && (
          <SketchBriefingPanel
            project={project}
            onUpdateProject={onUpdateProject}
            onNavigateToCopy={() => onSelectTab('copy')}
          />
        )}
        {activeTab === 'copy' && (
          <SketchCopyEditor
            project={project}
            onUpdateProject={onUpdateProject}
            selectedLayerId={selectedLayerId}
            onSelectLayer={onSelectLayer}
          />
        )}
        {activeTab === 'referencias' && (
          <SketchAttachmentsPanel
            project={project}
            onUpdateProject={onUpdateProject}
            onSelectLayer={onSelectLayer}
          />
        )}
      </div>
    </aside>
  );
}

function SketchRightSidebar({
  isOpen,
  activeTab,
  project,
  selectedLayerId,
  onSelectTab,
  onUpdateProject,
  onSelectLayer,
  onRestoreProject,
}: {
  isOpen: boolean;
  activeTab: RightTab;
  project: SketchProjectData;
  selectedLayerId: string | null;
  onSelectTab: (tab: RightTab) => void;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onSelectLayer: (layerId: string | null) => void;
  onRestoreProject: (restored: SketchProjectData) => void;
}) {
  if (!isOpen) return null;

  return (
    <aside className="w-80 shrink-0 border-l border-zinc-800 bg-[#0a0d14] flex flex-col h-full overflow-hidden">
      <div className="flex items-center border-b border-zinc-800 bg-[#0d1017] px-2 pt-2 text-xs font-medium">
        <button
          type="button"
          onClick={() => onSelectTab('propriedades')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors ${
            activeTab === 'propriedades'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Sliders size={13} />
          <span>Propriedades</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('camadas')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors ${
            activeTab === 'camadas'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Layers size={13} />
          <span>Camadas</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('versoes')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors ${
            activeTab === 'versoes'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <History size={13} />
          <span>Versões</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'propriedades' && (
          <SketchPropertiesPanel
            project={project}
            selectedLayerId={selectedLayerId}
            onUpdateProject={onUpdateProject}
            onSelectLayer={onSelectLayer}
          />
        )}
        {activeTab === 'camadas' && (
          <SketchLayersPanel
            project={project}
            selectedLayerId={selectedLayerId}
            onSelectLayer={onSelectLayer}
            onUpdateProject={onUpdateProject}
          />
        )}
        {activeTab === 'versoes' && (
          <SketchVersionManager
            project={project}
            onRestoreProject={onRestoreProject}
          />
        )}
      </div>
    </aside>
  );
}

const ACTIVE_PROJECT_KEY = 'kaoz_active_sketch_project_id';

function resolveTargetProjectId(projects: Array<{ id: string }>): string {
  try {
    const storedId = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;
    if (storedId && projects.some((p) => p.id === storedId)) {
      return storedId;
    }
  } catch {
    // Ignorar erro de leitura
  }
  return projects[0].id;
}

function storeActiveProjectId(id: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    }
  } catch {
    // Ignorar erro de escrita
  }
}

async function fetchActiveJobForProject(projectId: string): Promise<SketchJobData | null> {
  try {
    const res = await fetch(`/api/sketch/generate?projectId=${projectId}`);
    const data = await res.json();
    return data.success && data.activeJob ? data.activeJob : null;
  } catch {
    return null;
  }
}

async function pollJobById(jobId: string): Promise<SketchJobData | null> {
  try {
    const res = await fetch(`/api/sketch/jobs/${jobId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.success && data.job ? data.job : null;
  } catch {
    return null;
  }
}

async function cancelJobById(jobId: string): Promise<SketchJobData | null> {
  try {
    const res = await fetch(`/api/sketch/jobs/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    const data = await res.json();
    return data.success && data.job ? data.job : null;
  } catch {
    return null;
  }
}

async function submitGenerateJob(
  projectId: string,
  referenceDataUrl?: string
): Promise<{ success: boolean; job?: SketchJobData; activeJobId?: string; error?: string }> {
  try {
    const res = await fetch('/api/sketch/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        idempotencyToken: `idemp-${projectId}-${Date.now()}`,
        referenceDataUrl,
      }),
    });
    const data = await res.json();
    if (data.success && data.job) {
      return { success: true, job: data.job };
    }
    if (data.duplicate && data.activeJobId) {
      return { success: false, activeJobId: data.activeJobId, error: 'Trabalho já em andamento para este projeto' };
    }
    return { success: false, error: data.error || 'Falha ao iniciar geração' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro de conexão ao iniciar geração';
    return { success: false, error: msg };
  }
}

async function handleJobPollTick(
  activeJobId: string,
  currentProjectId: string | undefined,
  onJobUpdate: (job: SketchJobData) => void,
  onMergeVersionMetadata: (proj: SketchProjectData) => void
): Promise<boolean> {
  const updated = await pollJobById(activeJobId);
  if (!updated) return false;

  // Proteção contra respostas de outro projeto
  if (currentProjectId && updated.projectId !== currentProjectId) {
    return true; // Encerra o polling para este job no contexto do projeto atual
  }

  onJobUpdate(updated);

  if (!isJobActive(updated.status)) {
    if (updated.status === 'completed' && currentProjectId === updated.projectId) {
      const pRes = await fetch(`/api/sketch/projects/${currentProjectId}`);
      const pData = await pRes.json();
      if (pData.success && pData.project) {
        onMergeVersionMetadata(pData.project);
      }
    }
    return true;
  }
  return false;
}

async function applyResultBackground(
  projectId: string,
  imageUrl: string,
  flowPath?: string
): Promise<SketchProjectData | null> {
  try {
    const res = await fetch('/api/sketch/apply-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        imageUrl,
        flowMediaPath: flowPath,
      }),
    });
    const data = await res.json();
    return data.success && data.project ? data.project : null;
  } catch {
    return null;
  }
}

function SketchLoadingState() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#07090e] text-zinc-400 gap-2">
      <Loader2 size={24} className="animate-spin text-indigo-500" />
      <span className="text-sm">Carregando estúdio Sketch...</span>
    </div>
  );
}

function getProjectCanvasRatio(project: SketchProjectData): SketchCanvasAspectRatio {
  return project.canvasAspectRatio || (project.aspectRatio as SketchCanvasAspectRatio) || '1:1';
}

interface SketchCenterAreaProps {
  centerView: CenterViewMode;
  project: SketchProjectData;
  activeJob: SketchJobData | null;
  isGenerating: boolean;
  selectedLayerId: string | null;
  activeTool: SketchTool;
  strokeColor: string;
  strokeSize: number;
  boxLabel: string;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onSelectLayer: (layerId: string | null) => void;
  setActiveTool: (tool: SketchTool) => void;
  setStrokeColor: (color: string) => void;
  setStrokeSize: (size: number) => void;
  setBoxLabel: (label: string) => void;
  onSaveLayers: (layers?: SketchLayer[]) => void;
  onGenerateFlowImage: (referenceDataUrl?: string) => void;
  onCancelJob: (jobId: string) => void;
  onApplyResult: (imageUrl: string, flowPath?: string) => void;
}

function SketchCenterArea({
  centerView,
  project,
  activeJob,
  isGenerating,
  selectedLayerId,
  activeTool,
  strokeColor,
  strokeSize,
  boxLabel,
  onUpdateProject,
  onSelectLayer,
  setActiveTool,
  setStrokeColor,
  setStrokeSize,
  setBoxLabel,
  onSaveLayers,
  onGenerateFlowImage,
  onCancelJob,
  onApplyResult,
}: SketchCenterAreaProps) {
  if (centerView === 'canvas') {
    return (
      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        <SketchCanvas
          project={project}
          selectedLayerId={selectedLayerId}
          onSelectLayer={onSelectLayer}
          onUpdateProject={onUpdateProject}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          strokeColor={strokeColor}
          setStrokeColor={setStrokeColor}
          strokeSize={strokeSize}
          setStrokeSize={setStrokeSize}
          boxLabel={boxLabel}
          setBoxLabel={setBoxLabel}
          onApply={onSaveLayers}
          onCancel={onSaveLayers}
        />
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
      <SketchCompositePreviewPanel
        project={project}
        activeJob={activeJob}
        isGenerating={isGenerating}
        onGenerateFlowImage={onGenerateFlowImage}
        onCancelJob={onCancelJob}
        onApplyResult={onApplyResult}
        onCreateVariation={(refUrl) => onGenerateFlowImage(refUrl)}
        onRetryGeneration={(refUrl) => onGenerateFlowImage(refUrl)}
      />
    </main>
  );
}

export function SketchDashboard() {
  const [project, setProject] = useState<SketchProjectData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [savedTime, setSavedTime] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<LeftTab>('briefing');
  const [rightTab, setRightTab] = useState<RightTab>('propriedades');
  const [centerView, setCenterView] = useState<CenterViewMode>('canvas');

  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<SketchTool>('select');
  const [strokeColor, setStrokeColor] = useState('#6366f1');
  const [strokeSize, setStrokeSize] = useState(6);
  const [boxLabel, setBoxLabel] = useState('Produto');

  const [isProjectsModalOpen, setIsProjectsModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [activeJob, setActiveJob] = useState<SketchJobData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const coordinatorRef = useRef<SketchSaveCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new SketchSaveCoordinator(
      async (toSave) => {
        try {
          const res = await fetch(`/api/sketch/projects/${toSave.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toSave),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Erro ao salvar no servidor');
          }
          setSavedTime(new Date().toLocaleTimeString('pt-BR'));
          return true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Falha de conexão ao salvar';
          setSaveError(msg);
          return false;
        }
      },
      {
        onStatusChange: (status, err) => {
          setSaveStatus(status);
          setSaveError(err || null);
        },
      }
    );
  }
  const coordinator = coordinatorRef.current;

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;

    fetchActiveJobForProject(project.id).then((job) => {
      if (!cancelled && job && job.projectId === project.id) {
        setActiveJob(job);
        setIsGenerating(isJobActive(job.status));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  const handleMergeJobCompletionMetadata = useCallback((serverProject: SketchProjectData) => {
    setProject((current) => {
      if (!current || current.id !== serverProject.id) return current;
      return {
        ...current,
        generationHistory: serverProject.generationHistory || current.generationHistory,
        snapshots: serverProject.snapshots || current.snapshots,
      };
    });
  }, []);

  useEffect(() => {
    if (!activeJob || !isJobActive(activeJob.status)) {
      setIsGenerating(false);
      return;
    }

    if (project?.id && activeJob.projectId !== project.id) {
      setActiveJob(null);
      setIsGenerating(false);
      return;
    }

    setIsGenerating(true);
    const interval = setInterval(async () => {
      const finished = await handleJobPollTick(
        activeJob.id,
        project?.id,
        setActiveJob,
        handleMergeJobCompletionMetadata
      );
      if (finished) setIsGenerating(false);
    }, 1200);

    return () => clearInterval(interval);
  }, [activeJob?.id, activeJob?.status, activeJob?.projectId, project?.id, handleMergeJobCompletionMetadata]);

  const handleUpdateProject = useCallback(
    (updater: (prev: SketchProjectData) => SketchProjectData) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        const updated = { ...next, updatedAt: new Date().toISOString() };
        coordinator.registerEdit(updated);
        return updated;
      });
    },
    [coordinator]
  );

  const loadInitialProject = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/sketch/projects');
      const data = await res.json();
      if (!data.success || !Array.isArray(data.projects) || data.projects.length === 0) {
        setProject(null);
        setIsEmpty(true);
        return;
      }

      const targetId = resolveTargetProjectId(data.projects);
      const pRes = await fetch(`/api/sketch/projects/${targetId}`);
      const pData = await pRes.json();
      if (pData.success && pData.project) {
        coordinator.reset(0);
        setProject(pData.project);
        setIsEmpty(false);
        setSaveStatus('saved');
        storeActiveProjectId(pData.project.id);
      } else {
        setIsEmpty(true);
      }
    } catch {
      setIsEmpty(true);
    } finally {
      setIsLoading(false);
    }
  }, [coordinator]);

  useEffect(() => {
    loadInitialProject();
  }, [loadInitialProject]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1200) {
      setIsRightOpen(false);
    }
  }, []);

  useEffect(() => {
    const flushPending = () => {
      if (coordinator.isDirty()) {
        const pending = coordinator.getPendingRevision();
        if (pending) {
          try {
            fetch(`/api/sketch/projects/${pending.project.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(pending.project),
              keepalive: true,
            }).catch(() => {});
          } catch {
            // Ignore
          }
        }
      }
    };

    const handleBeforeUnload = () => flushPending();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      coordinator.clearTimer();
      flushPending();
    };
  }, [coordinator]);

  const handleOpenProject = async (id: string) => {
    if (project && project.id === id) return;

    if (coordinator.isDirty()) {
      await coordinator.flushSave();
    }
    coordinator.cancelPendingSave();

    try {
      const res = await fetch(`/api/sketch/projects/${id}`);
      const data = await res.json();
      if (data.success && data.project) {
        coordinator.reset(0);
        setProject(data.project);
        setSaveStatus('saved');
        setSaveError(null);
        setGenerationError(null);
        storeActiveProjectId(id);

        const job = await fetchActiveJobForProject(id);
        setActiveJob(job);
        setIsGenerating(isJobActive(job?.status));
      }
    } catch {
      setSaveError('Erro ao abrir o projeto selecionado.');
    }
  };

  const handleCreateNewProject = async (title: string, ratio: SketchAspectRatio) => {
    if (coordinator.isDirty()) {
      await coordinator.flushSave();
    }
    coordinator.cancelPendingSave();

    const res = await fetch('/api/sketch/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, aspectRatio: ratio }),
    });
    const data = await res.json();
    if (data.success && data.project) {
      coordinator.reset(0);
      setProject(data.project);
      setIsEmpty(false);
      setSaveStatus('saved');
      setSaveError(null);
      setGenerationError(null);
      setActiveJob(null);
      setIsGenerating(false);
      storeActiveProjectId(data.project.id);
    }
  };

  const handleRenameProject = async (id: string, newTitle: string) => {
    await fetch(`/api/sketch/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    if (project && project.id === id) {
      setProject((prev) => (prev ? { ...prev, title: newTitle } : prev));
    }
  };

  const handleDeleteProject = async (id: string) => {
    coordinator.cancelPendingSave();
    await fetch(`/api/sketch/projects/${id}`, { method: 'DELETE' });
    if (project && project.id === id) {
      await loadInitialProject();
    }
  };

  const handleGenerateFlowImage = async (referenceDataUrlOverride?: string) => {
    if (!project || isGenerating) return;
    setGenerationError(null);

    setSaveStatus('saving');
    const saveResult = await coordinator.flushSave();
    if (!saveResult.success) {
      setSaveStatus('error');
      setGenerationError(
        `Falha ao salvar o projeto antes da geração: ${saveResult.error || 'Erro de conexão'}. A geração foi abortada para proteger seu trabalho.`
      );
      return;
    }

    setSaveStatus('saved');
    setIsGenerating(true);
    setCenterView('preview');

    let refUrl = referenceDataUrlOverride;
    if (!refUrl && project.useSketchAsReference !== false) {
      try {
        refUrl = await renderCompositeReferenceDataUrl(project);
      } catch {
        // Fallback gracioso
      }
    }

    const res = await submitGenerateJob(project.id, refUrl);
    if (res.success && res.job) {
      setActiveJob(res.job);
    } else if (res.activeJobId) {
      const active = await pollJobById(res.activeJobId);
      if (active) setActiveJob(active);
    } else {
      setIsGenerating(false);
      setGenerationError(res.error || 'Falha ao iniciar trabalho de geração no servidor.');
    }
  };

  const handleCancelJob = async (jobId: string) => {
    const cancelled = await cancelJobById(jobId);
    if (cancelled) {
      setActiveJob(cancelled);
      setIsGenerating(false);
    }
  };

  const handleApplyResultAsBackground = async (imageUrl: string, flowPath?: string) => {
    if (!project) return;
    coordinator.cancelPendingSave();

    const updated = await applyResultBackground(project.id, imageUrl, flowPath);
    if (updated) {
      coordinator.reset(0);
      setProject(updated);
      setSaveStatus('saved');
      setSaveError(null);
      setCenterView('canvas');
    } else {
      setSaveError('Falha ao aplicar imagem como fundo.');
    }
  };

  const handleSaveLayers = useCallback(
    (layers?: SketchLayer[]) => {
      if (!project) return;
      handleUpdateProject((prev) => ({
        ...prev,
        layers: layers || prev.layers,
      }));
    },
    [handleUpdateProject, project]
  );

  const handleUpdateRatio = useCallback(
    (ratio: SketchCanvasAspectRatio) => {
      const preset = CANVAS_ASPECT_RATIO_PRESETS[ratio] || CANVAS_ASPECT_RATIO_PRESETS['1:1'];
      handleUpdateProject((prev) => ({
        ...prev,
        canvasAspectRatio: ratio,
        aspectRatio: resolveProviderAspectRatio(ratio),
        canvasDimensions: { width: preset.width, height: preset.height, unit: 'px' },
      }));
    },
    [handleUpdateProject]
  );

  const handleRetrySave = useCallback(async () => {
    setSaveStatus('saving');
    const res = await coordinator.flushSave();
    if (!res.success) {
      setSaveStatus('error');
    }
  }, [coordinator]);

  if (isLoading) {
    return <SketchLoadingState />;
  }

  if (!project || isEmpty) {
    return <SketchEmptyState onCreateProject={() => handleCreateNewProject('Primeiro Anúncio', '1:1')} />;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#07090e] text-white">
      <SketchTopBar
        title={project.title}
        canvasRatio={getProjectCanvasRatio(project)}
        saveStatus={saveStatus}
        savedTime={savedTime}
        saveError={saveError}
        centerView={centerView}
        isLeftOpen={isLeftOpen}
        isRightOpen={isRightOpen}
        isExporting={isExporting}
        activeJob={activeJob}
        onUpdateTitle={(title) => handleUpdateProject((prev) => ({ ...prev, title }))}
        onUpdateRatio={handleUpdateRatio}
        onToggleLeft={() => setIsLeftOpen((v) => !v)}
        onToggleRight={() => setIsRightOpen((v) => !v)}
        onChangeCenterView={setCenterView}
        onOpenProjectsModal={() => setIsProjectsModalOpen(true)}
        onRetrySave={handleRetrySave}
        onOpenExportModal={() => setIsExportModalOpen(true)}
      />

      {generationError && (
        <div className="flex items-center justify-between gap-2 bg-rose-950/90 border-b border-rose-800 px-4 py-2 text-xs text-rose-200 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="text-rose-400 shrink-0" />
            <span>{generationError}</span>
          </div>
          <button
            type="button"
            onClick={() => setGenerationError(null)}
            className="text-rose-400 hover:text-rose-200 text-xs underline font-medium"
          >
            Fechar
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SketchLeftSidebar
          isOpen={isLeftOpen}
          activeTab={leftTab}
          project={project}
          selectedLayerId={selectedLayerId}
          onSelectTab={setLeftTab}
          onUpdateProject={handleUpdateProject}
          onSelectLayer={setSelectedLayerId}
        />

        <SketchCenterArea
          centerView={centerView}
          project={project}
          activeJob={activeJob}
          isGenerating={isGenerating}
          selectedLayerId={selectedLayerId}
          activeTool={activeTool}
          strokeColor={strokeColor}
          strokeSize={strokeSize}
          boxLabel={boxLabel}
          onUpdateProject={handleUpdateProject}
          onSelectLayer={setSelectedLayerId}
          setActiveTool={setActiveTool}
          setStrokeColor={setStrokeColor}
          setStrokeSize={setStrokeSize}
          setBoxLabel={setBoxLabel}
          onSaveLayers={handleSaveLayers}
          onGenerateFlowImage={handleGenerateFlowImage}
          onCancelJob={handleCancelJob}
          onApplyResult={handleApplyResultAsBackground}
        />

        <SketchRightSidebar
          isOpen={isRightOpen}
          activeTab={rightTab}
          project={project}
          selectedLayerId={selectedLayerId}
          onSelectTab={setRightTab}
          onUpdateProject={handleUpdateProject}
          onSelectLayer={setSelectedLayerId}
          onRestoreProject={(restored) => handleUpdateProject(() => restored)}
        />
      </div>

      <SketchProjectsModal
        isOpen={isProjectsModalOpen}
        activeProjectId={project.id}
        onClose={() => setIsProjectsModalOpen(false)}
        onOpenProject={handleOpenProject}
        onCreateNewProject={handleCreateNewProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
      />

      <SketchExportModal
        isOpen={isExportModalOpen}
        project={project}
        onClose={() => setIsExportModalOpen(false)}
      />
    </div>
  );
}
