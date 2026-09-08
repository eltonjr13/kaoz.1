import { NextResponse } from 'next/server';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getAssetFilePath, isValidAssetFilename } from '@/lib/sketch/sketch-storage';

export const runtime = 'nodejs';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;
    if (!isValidAssetFilename(filename)) {
      return new NextResponse('Nome de asset inválido', { status: 400 });
    }

    const filePath = getAssetFilePath(filename);
    const fileStat = await fsp.stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return new NextResponse('Asset não encontrado', { status: 404 });
    }

    const content = await fsp.readFile(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao carregar asset';
    return new NextResponse(message, { status: 500 });
  }
}
