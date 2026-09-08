"use client";

import React, { useRef, useState, useEffect } from 'react';
import {
  Upload,
  Plus,
  Trash2,
  Image as ImageIcon,
  Sparkles,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  MAX_SKETCH_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
  type AttachmentRole,
  type ImageLayer,
  type SketchAttachment,
  type SketchProjectData,
} from '@/types/sketch';

interface SketchAttachmentsPanelProps {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onSelectLayer: (layerId: string | null) => void;
}

const ROLE_LABELS: Record<AttachmentRole, { label: string; desc: string }> = {
  product: {
    label: 'Produto',
    desc: 'Imagem do produto/embalagem para destaque e composição',
  },
  person: {
    label: 'Pessoa / Modelo',
    desc: 'Modelo humano, porta-voz ou avatar para a cena',
  },
  logo: {
    label: 'Logo da Marca',
    desc: 'Logotipo ou símbolo da marca',
  },
  style: {
    label: 'Estilo Visual',
    desc: 'Referência estética de iluminação, cores e atmosfera',
  },
  composition: {
    label: 'Composição / Layout',
    desc: 'Enquadramento e posicionamento espacial dos elementos',
  },
  background: {
    label: 'Fundo / Cenário',
    desc: 'Imagem ou textura de fundo da cena comercial',
  },
  reference: {
    label: 'Referência IA',
    desc: 'Enviada como referência visual ao FlowProvider',
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

function validateFilePreUpload(file: File, currentCount: number): string | null {
  if (currentCount >= MAX_SKETCH_ATTACHMENTS) {
    return `Limite máximo de ${MAX_SKETCH_ATTACHMENTS} anexos por projeto atingido. Remova um anexo antes de adicionar outro.`;
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `Arquivo "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) excede o limite de 10 MB.`;
  }
  const type = file.type.toLowerCase();
  const isAccepted = type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || type === 'image/jpg';
  if (!isAccepted) {
    return `Arquivo "${file.name}" possui formato inválido. Use PNG, JPEG ou WebP.`;
  }
  return null;
}

async function uploadAttachmentFile(
  file: File,
  role: AttachmentRole,
  projectId?: string,
  currentCount?: number
): Promise<SketchAttachment | null> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('role', role);
  formData.append('name', file.name);
  if (projectId) formData.append('projectId', projectId);
  if (currentCount !== undefined) formData.append('currentAttachmentCount', String(currentCount));

  const res = await fetch('/api/sketch/attachments', {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.success || !data.attachment) {
    throw new Error(data.error || 'Falha ao salvar anexo no servidor');
  }
  return data.attachment;
}

function createImageLayerFromAttachment(att: SketchAttachment): ImageLayer {
  const layerId = `layer-img-${Date.now()}`;
  const isLogo = att.role === 'logo';
  return {
    id: layerId,
    name: isLogo ? 'Logo' : att.name.replace(/\.[^/.]+$/, ''),
    type: 'image',
    attachmentId: att.id,
    imageUrl: att.dataUrl,
    role: att.role === 'reference' || att.role === 'inspiration' ? 'overlay' : att.role,
    visible: true,
    opacity: 1,
    x: isLogo ? 10 : 35,
    y: isLogo ? 8 : 35,
    width: isLogo ? 22 : 40,
    height: isLogo ? 12 : 40,
    rotation: 0,
  };
}

function AttachmentItemCard({
  att,
  isRef,
  onRemove,
  onUpdateRole,
  onSetRef,
  onInsert,
}: {
  att: SketchAttachment;
  isRef: boolean;
  onRemove: () => void;
  onUpdateRole: (role: AttachmentRole) => void;
  onSetRef: () => void;
  onInsert: () => void;
}) {
  return (
    <div
      className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${
        isRef ? 'border-indigo-500/60 bg-indigo-950/20' : 'border-zinc-800 bg-[#10131c]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
            <img src={att.dataUrl} alt={att.name} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-200 text-[11px]">{att.name}</p>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span>{ROLE_LABELS[att.role]?.label || att.role}</span>
              {att.width && att.height && (
                <span className="font-mono">({att.width}x{att.height})</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          title="Remover anexo"
          className="p-1 text-zinc-500 hover:text-rose-400"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/80">
        <select
          value={att.role}
          onChange={(e) => onUpdateRole(e.target.value as AttachmentRole)}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 outline-none"
        >
          <option value="product">Produto / Comercial</option>
          <option value="person">Pessoa / Modelo</option>
          <option value="logo">Logo da Marca</option>
          <option value="style">Estilo Visual</option>
          <option value="composition">Composição / Layout</option>
          <option value="background">Fundo / Cenário</option>
          <option value="reference">Referência IA</option>
          <option value="overlay">Sobreposição</option>
          <option value="inspiration">Inspiração</option>
        </select>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSetRef}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              isRef ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Sparkles size={11} />
            <span>{isRef ? 'Ref. Ativa' : 'Definir Ref.'}</span>
          </button>

          <button
            type="button"
            onClick={onInsert}
            title="Inserir como camada na prancheta"
            className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white"
          >
            <Plus size={11} />
            <span>Inserir</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SketchAttachmentsPanel({
  project,
  onUpdateProject,
  onSelectLayer,
}: SketchAttachmentsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const isLimitReached = project.attachments.length >= MAX_SKETCH_ATTACHMENTS;

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);

    let currentCount = project.attachments.length;
    const defaultRole = currentCount === 0 ? 'product' : 'reference';
    setIsUploading(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const preError = validateFilePreUpload(file, currentCount);
        if (preError) {
          setUploadError(preError);
          break;
        }

        const uploaded = await uploadAttachmentFile(file, defaultRole, project.id, currentCount);
        if (uploaded) {
          currentCount++;
          onUpdateProject((prev) => ({
            ...prev,
            attachments: [...prev.attachments, uploaded],
            activeReferenceId: prev.activeReferenceId || uploaded.id,
          }));
        }
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Falha no upload do arquivo');
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    const handlePanelPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        const dt = new DataTransfer();
        imageFiles.forEach((f) => dt.items.add(f));
        handleFileUpload(dt.files);
      }
    };

    window.addEventListener('paste', handlePanelPaste);
    return () => window.removeEventListener('paste', handlePanelPaste);
  }, [project.attachments.length, project.id]);

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

  const addAttachmentToComposition = (att: SketchAttachment) => {
    const newLayer = createImageLayerFromAttachment(att);
    onUpdateProject((prev) => ({
      ...prev,
      layers: [...prev.layers, newLayer],
    }));
    onSelectLayer(newLayer.id);
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
      <div className="border-b border-zinc-800 pb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <ImageIcon size={15} className="text-indigo-400" />
            <span>Anexos e Referências</span>
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            PNG, JPEG ou WebP de até 10 MB. Preservados no runtime com papéis comerciais.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold ${
            isLimitReached
              ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
              : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          {project.attachments.length}/{MAX_SKETCH_ATTACHMENTS}
        </span>
      </div>

      {uploadError && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5 text-rose-300 text-[11px]">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!isLimitReached) handleFileUpload(e.dataTransfer.files);
        }}
        onClick={() => {
          if (!isLimitReached) fileInputRef.current?.click();
        }}
        className={`flex flex-col items-center justify-center rounded-xl border border-dashed p-5 text-center transition-colors ${
          isLimitReached
            ? 'border-zinc-800 bg-zinc-950/40 text-zinc-600 cursor-not-allowed'
            : 'border-zinc-700 bg-zinc-900/40 cursor-pointer hover:border-indigo-500 hover:bg-zinc-900/70'
        }`}
      >
        {isUploading ? (
          <Loader2 size={22} className="animate-spin text-indigo-400 mb-1.5" />
        ) : (
          <Upload size={20} className={isLimitReached ? 'text-zinc-600 mb-1.5' : 'text-indigo-400 mb-1.5'} />
        )}
        <span className={`font-medium ${isLimitReached ? 'text-zinc-500' : 'text-zinc-200'}`}>
          {isUploading
            ? 'Validando e gravando arquivo...'
            : isLimitReached
            ? 'Limite de 6 anexos atingido'
            : 'Clique, cole (Ctrl+V) ou arraste imagens'}
        </span>
        <span className="text-[10px] text-zinc-500 mt-0.5">
          PNG, JPEG ou WebP (máx. 10 MB por arquivo)
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          disabled={isLimitReached}
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
      </div>

      {/* Attachments List */}
      <div className="flex flex-col gap-3">
        {project.attachments.length === 0 ? (
          <p className="text-center py-4 text-zinc-500 text-[11px]">Nenhum anexo adicionado ainda.</p>
        ) : (
          project.attachments.map((att) => (
            <AttachmentItemCard
              key={att.id}
              att={att}
              isRef={project.activeReferenceId === att.id}
              onRemove={() => removeAttachment(att.id)}
              onUpdateRole={(role) => updateAttachmentRole(att.id, role)}
              onSetRef={() =>
                onUpdateProject((prev) => ({
                  ...prev,
                  activeReferenceId: att.id,
                  useSketchAsReference: false,
                }))
              }
              onInsert={() => addAttachmentToComposition(att)}
            />
          ))
        )}
      </div>
    </div>
  );
}
