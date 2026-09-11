"use client";

import React, { useRef, useEffect, useState } from 'react';
import { Upload, X, Image as ImageIcon, Tag, AlertCircle } from 'lucide-react';
import {
  type SketchAttachment,
  type SketchReferenceRole,
  MAX_SKETCH_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '@/types/sketch';
import { resolveDefaultAttachmentRole } from '@/lib/sketch/sketch-attachment-roles';

export interface SketchAttachmentBarProps {
  attachments: SketchAttachment[];
  onAddAttachment: (attachment: SketchAttachment) => void;
  onUpdateRole: (id: string, role: SketchReferenceRole) => void;
  onRemoveAttachment: (id: string) => void;
  disabled?: boolean;
}

const ROLE_LABELS: Record<SketchReferenceRole, string> = {
  product: 'Produto',
  person: 'Pessoa',
  logo: 'Logo',
  style: 'Estilo',
  composition: 'Composição',
  background: 'Fundo',
};

const ALL_ROLES: SketchReferenceRole[] = [
  'product',
  'person',
  'logo',
  'style',
  'composition',
  'background',
];

function validateAttachmentFile(file: File): string | null {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/jpg'];
  if (!allowedTypes.includes(file.type)) {
    return 'Formato inválido. Use PNG, JPEG ou WEBP.';
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return 'Tamanho máximo excedido (limite: 10MB).';
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

function extractImageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data || !data.files) return [];
  const result: File[] = [];
  for (let i = 0; i < data.files.length; i++) {
    const f = data.files[i];
    if (f.type.startsWith('image/')) {
      result.push(f);
    }
  }
  return result;
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const tag = (target as HTMLElement).tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

function shouldHandleClipboardPaste(e: ClipboardEvent, disabled: boolean, canAddMore: boolean): boolean {
  if (disabled || !canAddMore) return false;
  if (isTextInputTarget(e.target) && (!e.clipboardData || !e.clipboardData.files.length)) {
    return false;
  }
  return true;
}

function AttachmentChip({
  attachment,
  onUpdateRole,
  onRemove,
  disabled,
}: {
  attachment: SketchAttachment;
  onUpdateRole: (role: SketchReferenceRole) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const currentRole = (attachment.role as SketchReferenceRole) || 'product';

  return (
    <div className="group relative flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1.5 pr-2.5 shadow-sm transition-all hover:border-zinc-700">
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="flex flex-col min-w-0">
        <span className="truncate max-w-[120px] text-xs font-medium text-zinc-200" title={attachment.name}>
          {attachment.name}
        </span>
        <div className="flex items-center gap-1">
          <Tag size={10} className="text-zinc-500 shrink-0" />
          <select
            value={currentRole}
            disabled={disabled}
            onChange={(e) => onUpdateRole(e.target.value as SketchReferenceRole)}
            className="cursor-pointer bg-transparent text-[10px] font-medium text-indigo-400 outline-none hover:text-indigo-300 disabled:opacity-50"
            title="Função da imagem"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r} className="bg-zinc-900 text-zinc-200">
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        className="ml-1 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400 disabled:opacity-50"
        title="Remover anexo"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function SketchAttachmentBar({
  attachments,
  onAddAttachment,
  onUpdateRole,
  onRemoveAttachment,
  disabled = false,
}: SketchAttachmentBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canAddMore = attachments.length < MAX_SKETCH_ATTACHMENTS;

  const processFile = async (file: File) => {
    if (!canAddMore) {
      setErrorMessage(`Limite máximo de ${MAX_SKETCH_ATTACHMENTS} anexos atingido.`);
      return;
    }
    const err = validateAttachmentFile(file);
    if (err) {
      setErrorMessage(err);
      return;
    }
    setErrorMessage(null);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const newAtt: SketchAttachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        dataUrl,
        role: resolveDefaultAttachmentRole(file.name),
        mimeType: file.type,
        createdAt: new Date().toISOString(),
      };
      onAddAttachment(newAtt);
    } catch {
      setErrorMessage('Falha ao processar anexo.');
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;
    for (let i = 0; i < files.length; i++) {
      await processFile(files[i]);
    }
  };

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!shouldHandleClipboardPaste(e, disabled, canAddMore)) return;
      const images = extractImageFilesFromClipboard(e.clipboardData);
      if (images.length === 0) return;

      e.preventDefault();
      for (const img of images) {
        await processFile(img);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [disabled, canAddMore, attachments.length]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span className="flex items-center gap-1.5 font-medium text-zinc-300">
          <ImageIcon size={14} className="text-indigo-400" />
          Referências e Imagens ({attachments.length}/{MAX_SKETCH_ATTACHMENTS})
        </span>
        <span className="text-[11px] text-zinc-500">Cole com Ctrl+V ou arraste</span>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg p-2">
          <AlertCircle size={13} className="shrink-0" />
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="ml-auto text-rose-400 hover:text-rose-200"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {attachments.map((att) => (
          <AttachmentChip
            key={att.id}
            attachment={att}
            onUpdateRole={(role) => onUpdateRole(att.id, role)}
            onRemove={() => onRemoveAttachment(att.id)}
            disabled={disabled}
          />
        ))}

        {canAddMore && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex items-center gap-1.5 rounded-xl border border-dashed px-3 py-2 text-xs font-medium cursor-pointer transition-all duration-150 ${
              isDragging
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <Upload size={13} />
            <span>Adicionar imagem</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
