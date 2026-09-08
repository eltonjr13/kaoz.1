"use client";

import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Loader2,
  Clock,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { SketchAspectRatio, SketchProjectData, SketchProjectSummary } from '@/types/sketch';

interface SketchProjectsModalProps {
  isOpen: boolean;
  activeProjectId?: string;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
  onCreateNewProject: (title: string, ratio: SketchAspectRatio) => Promise<void>;
  onRenameProject: (projectId: string, newTitle: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

function CreateProjectForm({
  isCreating,
  onSubmit,
  onCancel,
}: {
  isCreating: boolean;
  onSubmit: (title: string, ratio: SketchAspectRatio) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [aspectRatio, setAspectRatio] = useState<SketchAspectRatio>('1:1');

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3.5 text-xs text-white">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-indigo-300">Novo Projeto de Anúncio</span>
        <button type="button" onClick={onCancel} className="text-zinc-400 hover:text-white">
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-300 font-medium">Nome do Projeto</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Campanha Lançamento Outono"
          className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-300 font-medium">Formato / Proporção</label>
        <div className="flex flex-wrap gap-2">
          {(['1:1', '9:16', '16:9', '4:3', '3:4'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setAspectRatio(r)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                aspectRatio === r
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-zinc-800"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={isCreating}
          onClick={() => onSubmit(title.trim() || 'Novo Anúncio Estático', aspectRatio)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {isCreating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          <span>Criar Projeto</span>
        </button>
      </div>
    </div>
  );
}

function ProjectListItem({
  item,
  isActive,
  onOpen,
  onStartRename,
  onDelete,
}: {
  item: SketchProjectSummary;
  isActive: boolean;
  onOpen: (id: string) => void;
  onStartRename: (id: string, currentTitle: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`group flex items-center justify-between gap-3 rounded-xl border p-3 transition-all ${
        isActive
          ? 'border-indigo-500 bg-indigo-950/20'
          : 'border-zinc-800 bg-[#10131c] hover:border-zinc-700'
      }`}
    >
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onOpen(item.id)}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-xs truncate">{item.title}</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400">
            {item.aspectRatio}
          </span>
          {isActive && (
            <span className="rounded bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.2 text-[9px] font-medium">
              Aberto
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-1">
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {new Date(item.updatedAt).toLocaleDateString('pt-BR')}
          </span>
          <span className="flex items-center gap-1">
            <Layers size={10} />
            {item.layerCount} camadas
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onStartRename(item.id, item.title)}
          className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
          title="Renomear projeto"
        >
          <Edit2 size={13} />
        </button>

        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-rose-400"
          title="Excluir projeto"
        >
          <Trash2 size={13} />
        </button>

        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
            isActive
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {isActive ? 'Atual' : 'Abrir'}
        </button>
      </div>
    </div>
  );
}

export function SketchProjectsModal({
  isOpen,
  activeProjectId,
  onClose,
  onOpenProject,
  onCreateNewProject,
  onRenameProject,
  onDeleteProject,
}: SketchProjectsModalProps) {
  const [projects, setProjects] = useState<SketchProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const loadProjectList = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/sketch/projects');
      const data = await res.json();
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects);
      }
    } catch {
      // Ignorar
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadProjectList();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async (title: string, ratio: SketchAspectRatio) => {
    setIsCreating(true);
    try {
      await onCreateNewProject(title, ratio);
      setShowCreateForm(false);
      onClose();
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveRename = async (id: string) => {
    if (editingTitle.trim()) {
      await onRenameProject(id, editingTitle.trim());
      setEditingId(null);
      await loadProjectList();
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir este projeto?')) {
      await onDeleteProject(id);
      await loadProjectList();
    }
  };

  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-800 bg-[#0d1017] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-indigo-400" />
            <h3 className="font-semibold text-white text-sm">Projetos do Sketch</h3>
          </div>

          <div className="flex items-center gap-2">
            {!showCreateForm && (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
              >
                <Plus size={13} />
                <span>Novo Projeto</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {showCreateForm && (
            <CreateProjectForm
              isCreating={isCreating}
              onSubmit={handleCreate}
              onCancel={() => setShowCreateForm(false)}
            />
          )}

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar projetos..."
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
          />

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-zinc-400 gap-2">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">Carregando projetos...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Sparkles size={28} className="text-zinc-600 mb-2" />
              <p className="text-xs font-medium text-zinc-400">Nenhum projeto encontrado</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Crie seu primeiro anúncio acima</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((item) => {
                if (editingId === item.id) {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-xl border border-indigo-500/50 bg-[#10131c] p-3"
                    >
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-white outline-none focus:border-indigo-500"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(item.id)}
                        className="p-1 text-emerald-400 hover:text-emerald-300"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1 text-zinc-400 hover:text-white"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  );
                }

                return (
                  <ProjectListItem
                    key={item.id}
                    item={item}
                    isActive={item.id === activeProjectId}
                    onOpen={(id) => {
                      onOpenProject(id);
                      onClose();
                    }}
                    onStartRename={(id, curTitle) => {
                      setEditingId(id);
                      setEditingTitle(curTitle);
                    }}
                    onDelete={handleDelete}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
