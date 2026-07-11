import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const TEMP_REFERENCE_ROOT = path.resolve('storage/temp_uploads');
const GENERATED_ROOT = path.resolve('storage/generated');

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

export type SavedReferenceImage = {
  filePath: string;
  extension: string;
};

function isPathInside(root: string, candidate: string): boolean {
  const isWindows = process.platform === 'win32';
  const normalizedRoot = isWindows ? root.toLowerCase() : root;
  const normalizedCandidate = isWindows ? candidate.toLowerCase() : candidate;
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedCandidate.startsWith(prefix);
}

export function saveBase64ReferenceImage(base64Data: string, prefix = 'ref_image'): SavedReferenceImage {
  let mimeType = 'image/png';
  let encoded = base64Data;

  if (base64Data.startsWith('data:')) {
    const commaIdx = base64Data.indexOf(',');
    if (commaIdx !== -1) {
      const header = base64Data.substring(0, commaIdx);
      const semiColonIdx = header.indexOf(';');
      if (semiColonIdx !== -1) {
        mimeType = header.substring(5, semiColonIdx).toLowerCase();
      }
      encoded = base64Data.substring(commaIdx + 1);
    }
  }

  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) {
    throw new Error(`Formato de imagem de referencia nao suportado: ${mimeType}`);
  }

  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length === 0) throw new Error('A imagem de referencia esta vazia.');
  if (buffer.length > MAX_REFERENCE_BYTES) throw new Error('A imagem de referencia excede o limite de 10 MB.');

  fs.mkdirSync(TEMP_REFERENCE_ROOT, { recursive: true });
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '_');
  const filePath = path.join(TEMP_REFERENCE_ROOT, `${safePrefix}_${crypto.randomUUID()}${extension}`);
  fs.writeFileSync(filePath, buffer);
  return { filePath, extension };
}

export function resolveGeneratedReferencePath(referencePath: string): string | null {
  const absolutePath = path.resolve(referencePath);
  return isPathInside(GENERATED_ROOT, absolutePath) && fs.existsSync(absolutePath) ? absolutePath : null;
}

export function copyGeneratedReferenceToTemp(referencePath: string, prefix = 'ref_image'): string {
  const resolvedPath = resolveGeneratedReferencePath(referencePath);
  if (!resolvedPath) throw new Error('Imagem de referencia invalida ou fora do diretorio permitido.');

  fs.mkdirSync(TEMP_REFERENCE_ROOT, { recursive: true });
  const extension = path.extname(resolvedPath) || '.png';
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '_');
  const tempPath = path.join(TEMP_REFERENCE_ROOT, `${safePrefix}_${crypto.randomUUID()}${extension}`);
  fs.copyFileSync(resolvedPath, tempPath);
  return tempPath;
}

export function cleanupTemporaryReference(filePath?: string | null): void {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath);
  if (!isPathInside(TEMP_REFERENCE_ROOT, absolutePath) || !fs.existsSync(absolutePath)) return;
  fs.unlinkSync(absolutePath);
}
