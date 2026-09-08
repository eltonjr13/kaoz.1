"use client";

import React, { useState, useEffect } from 'react';
import {
  History,
  Save,
  RotateCcw,
  Trash2,
  Download,
  Upload,
  Clock,
  Check,
} from 'lucide-react';
import type {
  SketchProjectData,
  SketchVersionSnapshot,
} from '@/types/sketch';

interface SketchVersionManagerProps {
  project: SketchProjectData;
  onUpdateProject?: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onRestoreProject: (restored: SketchProjectData) => void;
}

const STORAGE_KEY_PREFIX = 'kaoz1:sketch:versions:';

export function SketchVersionManager({
  project,
  onUpdateProject,
  onRestoreProject,
}: SketchVersionManagerProps) {
  const [versions, setVersions] = useState<SketchVersionSnapshot[]>([]);
  const [versionLabel, setVersionLabel] = useState('');
  const [savedFeedback, setSavedFeedback] = useState(false);

  const storageKey = `${STORAGE_KEY_PREFIX}${project.id}`;

  useEffect(() => {
    if (project.snapshots && project.snapshots.length > 0) {
      setVersions(project.snapshots);
      return;
    }

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setVersions(JSON.parse(stored));
      }
    } catch {
      // Ignorar erro de leitura
    }
  }, [project.id, project.snapshots, storageKey]);

  const saveVersions = (updated: SketchVersionSnapshot[]) => {
    setVersions(updated);

    if (onUpdateProject) {
      onUpdateProject((prev) => ({
        ...prev,
        snapshots: updated,
      }));
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {
      // Ignorar fallback
    }
  };

  const handleCreateSnapshot = () => {
    const nextNumber = versions.length + 1;
    const label = versionLabel.trim() || `Versão ${nextNumber}`;

    const newSnapshot: SketchVersionSnapshot = {
      id: `snap-${Date.now()}`,
      versionNumber: nextNumber,
      label,
      timestamp: new Date().toISOString(),
      project: JSON.parse(JSON.stringify({ ...project, snapshots: [] })),
    };

    const updated = [newSnapshot, ...versions];
    saveVersions(updated);
    setVersionLabel('');
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  const handleRestoreSnapshot = (snapshot: SketchVersionSnapshot) => {
    const cloned = JSON.parse(JSON.stringify(snapshot.project));
    onRestoreProject(cloned);
  };

  const handleDeleteSnapshot = (id: string) => {
    const updated = versions.filter((v) => v.id !== id);
    saveVersions(updated);
  };

  const handleExportProjectJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(project, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `sketch-${project.title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`);
    dl.click();
    dl.remove();
  };

  const handleImportProjectJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && parsed.layers && parsed.copy) {
          onRestoreProject(parsed);
        }
      } catch {
        alert('Arquivo de projeto inválido.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs">
      <div className="border-b border-zinc-800 pb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <History size={15} className="text-indigo-400" />
          <span>Histórico e Versões</span>
        </h3>
        <p className="text-[11px] text-zinc-400 mt-0.5">
          Salve marcos versionados do projeto gravados com atomicidade no backend.
        </p>
      </div>

      {/* Create Version */}
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-[#10131c] p-3">
        <label className="text-[11px] font-medium text-zinc-300">Criar Novo Snapshot de Versão</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="Ex: Rascunho inicial com logo"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-white outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleCreateSnapshot}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            {savedFeedback ? <Check size={13} /> : <Save size={13} />}
            <span>{savedFeedback ? 'Salvo!' : 'Salvar'}</span>
          </button>
        </div>
      </div>

      {/* Backup Import/Export */}
      <div className="flex items-center justify-between gap-2 border-y border-zinc-800/80 py-2.5">
        <span className="text-zinc-400 text-[11px]">Backup do Projeto</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportProjectJson}
            title="Exportar projeto em JSON"
            className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700 hover:text-white"
          >
            <Download size={12} />
            <span>JSON</span>
          </button>

          <label className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700 hover:text-white cursor-pointer">
            <Upload size={12} />
            <span>Importar</span>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportProjectJson}
            />
          </label>
        </div>
      </div>

      {/* Versions List */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-zinc-400">Versões Salvas ({versions.length})</span>
        {versions.length === 0 ? (
          <p className="text-center py-4 text-zinc-500 text-[11px]">Nenhuma versão salva ainda.</p>
        ) : (
          versions.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-[#10131c] p-2.5 hover:border-zinc-700 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-zinc-200 truncate">{snap.label}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400 font-mono">
                    v{snap.versionNumber}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mt-0.5">
                  <Clock size={10} />
                  <span>{new Date(snap.timestamp).toLocaleString('pt-BR')}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleRestoreSnapshot(snap)}
                  title="Restaurar esta versão"
                  className="flex items-center gap-1 rounded bg-indigo-600/20 px-2 py-1 text-indigo-300 hover:bg-indigo-600 hover:text-white transition-colors"
                >
                  <RotateCcw size={11} />
                  <span>Restaurar</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteSnapshot(snap.id)}
                  title="Excluir versão"
                  className="p-1 text-zinc-500 hover:text-rose-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
