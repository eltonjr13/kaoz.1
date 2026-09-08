import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { saveAssetFromBuffer } from '@/lib/sketch/sketch-storage';
import { SKETCH_SCHEMA_VERSION, type AttachmentRole, type SketchAttachment } from '@/types/sketch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleFormDataUpload(formData: FormData): Promise<SketchAttachment | null> {
  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) return null;

  const role = (formData.get('role') as AttachmentRole) || 'product';
  const customName = formData.get('name') as string | null;
  const fileName = (file instanceof File && file.name) ? file.name : (customName || 'attachment.png');
  const buffer = Buffer.from(await file.arrayBuffer());
  const assetId = `att-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const saved = await saveAssetFromBuffer(assetId, buffer, file.type || 'image/png', fileName);

  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: saved.assetId,
    name: fileName,
    dataUrl: saved.url,
    filePath: saved.filename,
    role,
    mimeType: saved.mimeType,
    createdAt: new Date().toISOString(),
  };
}

async function handleJsonUpload(body: Record<string, unknown>): Promise<SketchAttachment | null> {
  const dataUrl = body.dataUrl as string;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

  const role = (body.role as AttachmentRole) || 'product';
  const name = (body.name as string) || 'attachment.png';
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;

  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const buffer = Buffer.from(match[2], 'base64');
  const assetId = `att-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const saved = await saveAssetFromBuffer(assetId, buffer, `image/${ext}`, name);

  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: saved.assetId,
    name,
    dataUrl: saved.url,
    filePath: saved.filename,
    role,
    mimeType: saved.mimeType,
    createdAt: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let attachment: SketchAttachment | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      attachment = await handleFormDataUpload(formData);
    } else {
      const body = await req.json();
      attachment = await handleJsonUpload(body);
    }

    if (!attachment) {
      return NextResponse.json({ success: false, error: 'Arquivo inválido ou ausente' }, { status: 400 });
    }

    return NextResponse.json({ success: true, attachment }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha no upload';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
