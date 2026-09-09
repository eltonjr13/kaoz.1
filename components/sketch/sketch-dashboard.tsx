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
  type SketchProjectData,
  type SketchTool,
} from '@/types/sketch';
import { isJobActive } from '@/lib/sketch/sketch-job-manager';
import { SketchCanvas } from './sketch-canvas';
import { SketchCopyEditor } from './sketch-copy-editor';
import { SketchAttachmentsPanel } from './sketch-attachments-panel';
import { SketchLayersPanel } from './sketch-layers-panel';
import { SketchVersionManager } from './sketch-version-manager';
import { SketchBriefingPanel } from './sketch-briefing-panel';
import { SketchPropertiesPanel } from './sketch-properties-panel';
import { SketchProjectsModal } from './sketch-projects-modal';
import { SketchCompositePreviewPanel } from './sketch-composite-preview-panel';
import { downloadComposition } from '@/lib/sketch/sketch-exporter';

type LeftTab = 'briefing' | 'copy' | 'referencias';
type RightTab = 'propriedades' | 'camadas' | 'versoes';
type CenterViewMode = 'canvas' | 'preview';
type SaveStatus = 'saved' | 'saving' | 'error';

function SaveStatusIndicator({
  status,
  savedTime,
  onRetry,
}: {
  status: SaveStatus;
  savedTime: string;
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
      <div className="flex items-center gap-1.5 text-[11px] text-rose-400">
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
  onExport,
  activeJob,
}: {
  title: string;
  canvasRatio: SketchCanvasAspectRatio;
  saveStatus: SaveStatus;
  savedTime: string;
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
  onExport: (format: 'png' | 'jpeg') => void;
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
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
          title="Abrir gerenciador de projetos"
        >
          <FolderOpen size={14} className="text-indigo-400" />
          <span className="hidden sm:inline">Projetos</span>
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <input
            type="text"
            value={title}
            onChange={(e) => onUpdateTitle(e.target.value)}
            className="w-32 sm:w-44 lg:w-48 truncate bg-transparent font-semibold text-white outline-none hover:border-b hover:border-zinc-600 focus:border-b focus:border-indigo-500"
            title="Clique para renomear o projeto"
          />
        </div>
      </div>

      {/* Formato e Visualização Central */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
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

      {/* Estado do Salvamento e Exportação */}
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

        <SaveStatusIndicator status={saveStatus} savedTime={savedTime} onRetry={onRetrySave} />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onExport('jpeg')}
            disabled={isExporting}
            className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 sm:px-2.5 text-xs text-zinc-200 hover:bg-zinc-700 hover:text-white disabled:opacity-50"
          >
            <Download size={12} />
            <span>JPEG</span>
          </button>
          <button
            type="button"
            onClick={() => onExport('png')}
            disabled={isExporting}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 sm:px-2.5 text-xs font-medium text-white shadow hover:bg-indigo-500 disabled:opacity-50"
          >
            {isExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            <span>PNG</span>
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
    <aside className="w-[280px] xl:w-[330px] shrink-0 border-r border-zinc-800 bg-[#0d1017] flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-zinc-800 bg-[#090b10] px-2 py-1.5 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onSelectTab('briefing')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'briefing' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <FileText size={13} />
          <span>Briefing</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('copy')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'copy' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Sparkles size={13} />
          <span>Copy</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('referencias')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'referencias' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <ImageIcon size={13} />
          <span>Referências</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
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
    <aside className="w-[260px] xl:w-[310px] shrink-0 border-l border-zinc-800 bg-[#0d1017] flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-zinc-800 bg-[#090b10] px-2 py-1.5 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onSelectTab('propriedades')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'propriedades' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Sliders size={13} />
          <span>Propriedades</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('camadas')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'camadas' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Layers size={13} />
          <span>Camadas</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('versoes')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'versoes' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <History size={13} />
          <span>Versões</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
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
            onUpdateProject={onUpdateProject}
            onSelectLayer={onSelectLayer}
          />
        )}
        {activeTab === 'versoes' && (
          <SketchVersionManager
            project={project}
            onUpdateProject={onUpdateProject}
            onRestoreProject={onRestoreProject}
          />
        )}
      </div>
    </aside>
  );
}

function SketchEmptyState({
  onCreateProject,
}: {
  onCreateProject: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#07090e] p-6 text-center text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 mb-4">
        <Pencil size={32} />
      </div>
      <h2 className="text-xl font-bold">Nenhum projeto encontrado</h2>
      <p className="max-w-md text-sm text-zinc-400 mt-2 mb-6">
        Crie seu primeiro anúncio estático com IA. Utilize a prancheta de composição, gere copies de alta conversão e exporte artes completas.
      </p>
      <button
        type="button"
        onClick={onCreateProject}
        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all"
      >
        <Plus size={16} />
        <span>Criar Primeiro Projeto</span>
      </button>
    </div>
  );
}

const ACTIVE_PROJECT_KEY = 'kaoz1:sketch:active-project-id';

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
): Promise<{ success: boolean; job?: SketchJobData; activeJobId?: string }> {
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
      return { success: false, activeJobId: data.activeJobId };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

async function handleJobPollTick(
  activeJobId: string,
  projectId: string | undefined,
  onJobUpdate: (job: SketchJobData) => void,
  onProjectRefresh: (proj: SketchProjectData) => void
): Promise<boolean> {
  const updated = await pollJobById(activeJobId);
  if (!updated) return false;
  onJobUpdate(updated);
  if (!isJobActive(updated.status)) {
    if (updated.status === 'completed' && projectId) {
      const pRes = await fetch(`/api/sketch/projects/${projectId}`);
      const pData = await pRes.json();
      if (pData.success && pData.project) {
        onProjectRefresh(pData.project);
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

function hasNoProject(project: SketchProjectData | null, isEmpty: boolean): boolean {
  return isEmpty || !project;
}

function SketchLoadingState() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#07090e] text-zinc-400 gap-2">
      <Loader2 size={24} className="animate-spin text-indigo-500" />
      <span className="text-sm">Carregando estúdio Sketch...</span>
    </div>
  );
}

export function SketchDashboard() {
  const [project, setProject] = useState<SketchProjectData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [savedTime, setSavedTime] = useState('');

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
  const [isExporting, setIsExporting] = useState(false);

  const [activeJob, setActiveJob] = useState<SketchJobData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;

    fetchActiveJobForProject(project.id).then((job) => {
      if (!cancelled && job) {
        setActiveJob(job);
        setIsGenerating(isJobActive(job.status));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  useEffect(() => {
    if (!activeJob || !isJobActive(activeJob.status)) {
      setIsGenerating(false);
      return;
    }

    setIsGenerating(true);
    const interval = setInterval(async () => {
      const finished = await handleJobPollTick(
        activeJob.id,
        project?.id,
        setActiveJob,
        setProject
      );
      if (finished) setIsGenerating(false);
    }, 1200);

    return () => clearInterval(interval);
  }, [activeJob?.id, activeJob?.status, project?.id]);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingProjectRef = useRef<SketchProjectData | null>(null);

  const persistToBackend = useCallback(async (toSave: SketchProjectData) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/sketch/projects/${toSave.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSave),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao persistir');
      }
      setSaveStatus('saved');
      setSavedTime(new Date().toLocaleTimeString('pt-BR'));
    } catch {
      setSaveStatus('error');
    }
  }, []);

  const handleUpdateProject = useCallback(
    (updater: (prev: SketchProjectData) => SketchProjectData) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        const updated = { ...next, updatedAt: new Date().toISOString() };
        pendingProjectRef.current = updated;

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          persistToBackend(updated);
        }, 700);

        return updated;
      });
    },
    [persistToBackend]
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
        setProject(pData.project);
        setIsEmpty(false);
        storeActiveProjectId(pData.project.id);
      } else {
        setIsEmpty(true);
      }
    } catch {
      setIsEmpty(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      if (pendingProjectRef.current) {
        const payload = JSON.stringify(pendingProjectRef.current);
        try {
          fetch(`/api/sketch/projects/${pendingProjectRef.current.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        } catch {
          // Ignore
        }
      }
    };

    const handleBeforeUnload = () => flushPending();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      flushPending();
    };
  }, []);

  const handleOpenProject = async (id: string) => {
    if (pendingProjectRef.current) {
      await persistToBackend(pendingProjectRef.current);
    }
    try {
      const res = await fetch(`/api/sketch/projects/${id}`);
      const data = await res.json();
      if (data.success && data.project) {
        setProject(data.project);
        setSaveStatus('saved');
        storeActiveProjectId(id);
      }
    } catch {
      // Ignorar erro ao abrir
    }
  };

  const handleCreateNewProject = async (title: string, ratio: SketchAspectRatio) => {
    const res = await fetch('/api/sketch/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, aspectRatio: ratio }),
    });
    const data = await res.json();
    if (data.success && data.project) {
      setProject(data.project);
      setIsEmpty(false);
      setSaveStatus('saved');
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
    await fetch(`/api/sketch/projects/${id}`, { method: 'DELETE' });
    if (project && project.id === id) {
      await loadInitialProject();
    }
  };

  const handleGenerateFlowImage = async (referenceDataUrl?: string) => {
    if (!project || isGenerating) return;
    setIsGenerating(true);
    setCenterView('preview');

    const res = await submitGenerateJob(project.id, referenceDataUrl);
    if (res.success && res.job) {
      setActiveJob(res.job);
    } else if (res.activeJobId) {
      const active = await pollJobById(res.activeJobId);
      if (active) setActiveJob(active);
    } else {
      setIsGenerating(false);
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
    const updated = await applyResultBackground(project.id, imageUrl, flowPath);
    if (updated) {
      setProject(updated);
      setCenterView('canvas');
    }
  };

  const handleExport = async (format: 'png' | 'jpeg') => {
    if (!project) return;
    setIsExporting(true);
    try {
      await downloadComposition(project, format);
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return <SketchLoadingState />;
  }

  if (!project || hasNoProject(project, isEmpty)) {
    return <SketchEmptyState onCreateProject={() => handleCreateNewProject('Primeiro Anúncio', '1:1')} />;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#07090e] text-white">
      <SketchTopBar
        title={project.title}
        canvasRatio={project.canvasAspectRatio || project.aspectRatio || '1:1'}
        saveStatus={saveStatus}
        savedTime={savedTime}
        centerView={centerView}
        isLeftOpen={isLeftOpen}
        isRightOpen={isRightOpen}
        isExporting={isExporting}
        activeJob={activeJob}
        onUpdateTitle={(title) => handleUpdateProject((prev) => ({ ...prev, title }))}
        onUpdateRatio={(ratio) => {
          const preset = CANVAS_ASPECT_RATIO_PRESETS[ratio] || CANVAS_ASPECT_RATIO_PRESETS['1:1'];
          handleUpdateProject((prev) => ({
            ...prev,
            canvasAspectRatio: ratio,
            aspectRatio: resolveProviderAspectRatio(ratio),
            canvasDimensions: { width: preset.width, height: preset.height, unit: 'px' },
          }));
        }}
        onToggleLeft={() => setIsLeftOpen((v) => !v)}
        onToggleRight={() => setIsRightOpen((v) => !v)}
        onChangeCenterView={setCenterView}
        onOpenProjectsModal={() => setIsProjectsModalOpen(true)}
        onRetrySave={() => {
          const toSave = pendingProjectRef.current || project;
          if (toSave) persistToBackend(toSave);
        }}
        onExport={handleExport}
      />

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

        <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
          {centerView === 'canvas' ? (
            <SketchCanvas
              key={project.id}
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
              onApply={(appliedLayers) => {
                if (project) {
                  const toSave = {
                    ...project,
                    layers: appliedLayers || project.layers,
                    updatedAt: new Date().toISOString(),
                  };
                  setProject(toSave);
                  persistToBackend(toSave);
                }
              }}
              onCancel={(restoredLayers) => {
                if (project) {
                  const toSave = {
                    ...project,
                    layers: restoredLayers || project.layers,
                    updatedAt: new Date().toISOString(),
                  };
                  setProject(toSave);
                  persistToBackend(toSave);
                }
              }}
            />
          ) : (
            <SketchCompositePreviewPanel
              project={project}
              activeJob={activeJob}
              isGenerating={isGenerating}
              onGenerateFlowImage={handleGenerateFlowImage}
              onCancelJob={handleCancelJob}
              onApplyResult={handleApplyResultAsBackground}
              onCreateVariation={() => handleGenerateFlowImage()}
              onRetryGeneration={() => handleGenerateFlowImage()}
            />
          )}
        </main>

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
    </div>
  );
}
