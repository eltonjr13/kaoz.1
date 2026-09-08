"use client";

import React, { useRef } from 'react';
import {
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  Image as ImageIcon,
  Layers,
  Sparkles,
} from 'lucide-react';
import type {
  AttachmentRole,
  ImageLayer,
  SketchAttachment,
  SketchProjectData,
} from '@/types/sketch';

interface SketchAttachmentsPanelProps {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onSelectLayer: (layerId: string | null) => void;
}

const ROLE_LABELS: Record<AttachmentRole, { label: string; desc: string }> = {
  reference: {
    label: 'Referência IA',
    desc: 'Enviada como referência visual única ao FlowProvider na geração',
  },
  logo: {
    label: 'Logo da Marca',
    desc: 'Camada gráfica de logotipo sobreposta à arte final',
  },
  product: {
    label: 'Produto / Recorte',
    desc: 'Camada do produto com transparência posicionada no anúncio',
  },
  overlay: {
    label: 'Sobreposição / Badge',
    desc: 'Elemento visual decorativo ou selo adicional',
  },
  inspiration: {
    label: 'Inspiração',
    desc: 'Guia de estilo e composição conceitual',
  },
};

export function SketchAttachmentsPanel({
  project,
  onUpdateProject,
  onSelectLayer,
}: SketchAttachmentsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        if (!dataUrl) return;

        const newAttachment: SketchAttachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          dataUrl,
          role: project.attachments.length === 0 ? 'reference' : 'logo',
          createdAt: new Date().toISOString(),
        };

        onUpdateProject((prev) => ({
          ...prev,
          attachments: [...prev.attachments, newAttachment],
          // Se for a primeira imagem ou configurada como referência, marca como ativa
          activeReferenceId:
            !prev.activeReferenceId && newAttachment.role === 'reference'
              ? newAttachment.id
              : prev.activeReferenceId,
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFileUpload(e.dataTransfer.files);
  };

  const updateAttachmentRole = (id: string, role: AttachmentRole) => {
    onUpdateProject((prev) => {
      const updatedAttachments = prev.attachments.map((att) =>
        att.id === id ? { ...att, role } : att
      );
      const isRef = role === 'reference';
      return {
        ...prev,
        attachments: updatedAttachments,
        activeReferenceId: isRef ? id : prev.activeReferenceId === id ? undefined : prev.activeReferenceId,
      };
    });
  };

  const setAsActiveAiReference = (id: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      activeReferenceId: id,
      useSketchAsReference: false,
    }));
  };

  const addAttachmentToComposition = (att: SketchAttachment) => {
    const layerId = `layer-img-${Date.now()}`;
    const newLayer: ImageLayer = {
      id: layerId,
      name: att.role === 'logo' ? 'Logo' : att.name.replace(/\.[^/.]+$/, ''),
      type: 'image',
      attachmentId: att.id,
      imageUrl: att.dataUrl,
      role: att.role === 'reference' || att.role === 'inspiration' ? 'overlay' : att.role,
      visible: true,
      opacity: 1,
      x: att.role === 'logo' ? 10 : 35,
      y: att.role === 'logo' ? 8 : 35,
      width: att.role === 'logo' ? 22 : 40,
      height: att.role === 'logo' ? 12 : 40,
      rotation: 0,
    };

    onUpdateProject((prev) => ({
      ...prev,
      layers: [...prev.layers, newLayer],
    }));

    onSelectLayer(layerId);
  };

  const removeAttachment = (id: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((a) => a.id !== id),
      activeReferenceId: prev.activeReferenceId === id ? undefined : prev.activeReferenceId,
    }));
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs">
      <div className="border-b border-[var(--line)] pb-3">
        <h3 className="text-sm font-semibold text-white">Anexos de Imagens</h3>
        <p className="text-[11px] text-zinc-400">
          Anexe imagens com papéis distintos: Referência IA (FlowProvider aceita 1 por vez), Logos e Camadas de Produto.
        </p>
      </div>

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-5 text-center cursor-pointer hover:border-indigo-500 hover:bg-zinc-900/70 transition-colors"
      >
        <Upload size={20} className="text-indigo-400 mb-1.5" />
        <span className="font-medium text-zinc-200">Clique ou arraste imagens aqui</span>
        <span className="text-[10px] text-zinc-500 mt-0.5">PNG, JPG, WebP ou SVG</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
      </div>

      {/* Attachments List */}
      <div className="flex flex-col gap-3">
        {project.attachments.length === 0 ? (
          <p className="text-center py-4 text-zinc-500 text-[11px]">Nenhum anexo adicionado ainda.</p>
        ) : (
          project.attachments.map((att) => {
            const isRef = project.activeReferenceId === att.id;
            return (
              <div
                key={att.id}
                className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${
                  isRef
                    ? 'border-indigo-500/60 bg-indigo-950/20'
                    : 'border-zinc-800 bg-[#10131c]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={att.dataUrl} alt={att.name} className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-200 text-[11px]">{att.name}</p>
                      <p className="text-[10px] text-zinc-500">{ROLE_LABELS[att.role].label}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    title="Remover anexo"
                    className="p-1 text-zinc-500 hover:text-rose-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Role selection & Actions */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/80">
                  <select
                    value={att.role}
                    onChange={(e) => updateAttachmentRole(att.id, e.target.value as AttachmentRole)}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 outline-none"
                  >
                    <option value="reference">Referência IA (FlowProvider)</option>
                    <option value="logo">Logo da Marca (Camada)</option>
                    <option value="product">Produto / Recorte (Camada)</option>
                    <option value="overlay">Sobreposição (Camada)</option>
                    <option value="inspiration">Inspiração de Estilo</option>
                  </select>

                  <div className="flex items-center gap-1.5">
                    {att.role === 'reference' && (
                      <button
                        type="button"
                        onClick={() => setAsActiveAiReference(att.id)}
                        className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                          isRef
                            ? 'bg-indigo-600 text-white'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        <Sparkles size={11} />
                        <span>{isRef ? 'Referência Ativa' : 'Definir como Ref.'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => addAttachmentToComposition(att)}
                      title="Inserir como camada na composição"
                      className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white"
                    >
                      <Plus size={11} />
                      <span>Inserir</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
