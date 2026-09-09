import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { saveAssetFromBuffer, getProject } from '@/lib/sketch/sketch-storage';
import { validateAttachmentBuffer, type AttachmentValidationResult } from '@/lib/sketch/sketch-attachment-validator';
import {
  SKETCH_SCHEMA_VERSION,
  type AttachmentRole,
  type SketchAttachment,
} from '@/types/sketch';
import { sketchJobManager } from '@/lib/sketch/sketch-job-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UploadInput {
  buffer: Buffer;
  role: AttachmentRole;
  fileName: string;
  projectId?: string;
  currentCount?: number;
}

async function resolveProjectAttachmentCount(projectId?: string, fallbackCount?: number): Promise<number> {
  let diskCount = 0;
  if (projectId) {
    try {
      const proj = await getProject(projectId);
      if (proj && Array.isArray(proj.attachments)) {
        diskCount = proj.attachments.length;
      }
    } catch {
      // Fallback
    }
  }
  return Math.max(diskCount, fallbackCount ?? 0);
}

async function parseMultipartForm(formData: FormData): Promise<UploadInput | null> {
  const rawFile = formData.get('file');
  if (!rawFile || !(rawFile instanceof Blob)) return null;

  const role = (formData.get('role') as AttachmentRole) || 'product';
  const customName = formData.get('name') as string | null;
  const fileName = (rawFile instanceof File && rawFile.name) ? rawFile.name : (customName || 'attachment.png');
  const projectId = (formData.get('projectId') as string) || undefined;
  const rawCount = formData.get('currentAttachmentCount');
  const currentCount = rawCount ? Number(rawCount) : undefined;
  const buffer = Buffer.from(await rawFile.arrayBuffer());

  return { buffer, role, fileName, projectId, currentCount };
}

function parseJsonBody(body: Record<string, unknown>): UploadInput | null {
  const dataUrl = body.dataUrl as string;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;

  const role = (body.role as AttachmentRole) || 'product';
  const fileName = (body.name as string) || 'attachment.png';
  const projectId = (body.projectId as string) || undefined;
  const currentCount = typeof body.currentAttachmentCount === 'number' ? body.currentAttachmentCount : undefined;
  const buffer = Buffer.from(match[2], 'base64');

  return { buffer, role, fileName, projectId, currentCount };
}

async function parseRequestInput(req: Request): Promise<UploadInput | null> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    return await parseMultipartForm(formData);
  }
  const body = await req.json().catch(() => ({}));
  return parseJsonBody(body);
}

async function processAttachmentUpload(
  input: UploadInput
): Promise<{ error?: string; statusCode?: number; attachment?: SketchAttachment }> {
  const currentCount = await resolveProjectAttachmentCount(input.projectId, input.currentCount);
  const validation: AttachmentValidationResult = await validateAttachmentBuffer(input.buffer, {
    currentAttachmentCount: currentCount,
  });

  if (!validation.valid) {
    return { error: validation.error, statusCode: validation.statusCode };
  }

  const assetId = `att-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const saved = await saveAssetFromBuffer(assetId, input.buffer, validation.mimeType, input.fileName);

  const attachment: SketchAttachment = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: saved.assetId,
    name: input.fileName,
    dataUrl: saved.url,
    filePath: saved.filename,
    role: input.role,
    mimeType: validation.mimeType,
    width: validation.width,
    height: validation.height,
    createdAt: new Date().toISOString(),
  };

  return { attachment };
}

export async function POST(req: Request) {
  try {
    const input = await parseRequestInput(req);
    if (!input) {
      return NextResponse.json(
        { success: false, error: 'Arquivo inválido ou corpo de requisição ausente.' },
        { status: 400 }
      );
    }

    const result = await processAttachmentUpload(input);
    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.statusCode || 400 }
      );
    }

    return NextResponse.json({ success: true, attachment: result.attachment }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha no processamento do anexo';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const attachmentId = searchParams.get('attachmentId') || '';

    if (!attachmentId) {
      return NextResponse.json(
        { success: false, error: 'attachmentId obrigatório.' },
        { status: 400 }
      );
    }

    const inUse = await sketchJobManager.isAttachmentInUse(attachmentId);
    if (inUse) {
      return NextResponse.json(
        {
          success: false,
          error: 'Este anexo está em uso por uma geração ativa e não pode ser removido.',
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Anexo verificado e liberado para remoção.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao verificar anexo.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
