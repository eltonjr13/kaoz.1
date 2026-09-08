import sharp from 'sharp';
import {
  MAX_SKETCH_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_MEGAPIXELS,
} from '../../types/sketch.ts';

export type DetectedImageFormat = 'png' | 'jpeg' | 'webp';

export interface AttachmentValidationSuccess {
  valid: true;
  format: DetectedImageFormat;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
}

export interface AttachmentValidationFailure {
  valid: false;
  error: string;
  statusCode: number;
}

export type AttachmentValidationResult =
  | AttachmentValidationSuccess
  | AttachmentValidationFailure;

function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function isJpeg(buf: Buffer): boolean {
  return (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  );
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  );
}

export function detectImageFormatFromMagicBytes(buf: Buffer): DetectedImageFormat | null {
  if (isPng(buf)) return 'png';
  if (isJpeg(buf)) return 'jpeg';
  if (isWebp(buf)) return 'webp';
  return null;
}

function validateDimensions(
  width: number,
  height: number
): { ok: boolean; error?: string } {
  if (width <= 0 || height <= 0) {
    return { ok: false, error: 'Dimensões de imagem inválidas (largura ou altura zerada).' };
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      error: `Dimensão excede o limite máximo permitido (${MAX_IMAGE_DIMENSION}px). Imagem: ${width}x${height}px.`,
    };
  }
  const megapixels = (width * height) / 1_000_000;
  if (megapixels > MAX_IMAGE_MEGAPIXELS) {
    return {
      ok: false,
      error: `Resolução total excede o limite de ${MAX_IMAGE_MEGAPIXELS} MP (${megapixels.toFixed(1)} MP).`,
    };
  }
  return { ok: true };
}

function formatMimeType(format: DetectedImageFormat): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

function validatePrechecks(
  buffer: Buffer,
  count?: number
): AttachmentValidationFailure | null {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Arquivo vazio ou buffer ausente.', statusCode: 400 };
  }

  if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Tamanho do arquivo (${sizeMb} MB) excede o limite máximo permitido de 10 MB.`,
      statusCode: 413,
    };
  }

  if ((count ?? 0) >= MAX_SKETCH_ATTACHMENTS) {
    return {
      valid: false,
      error: `Limite máximo de ${MAX_SKETCH_ATTACHMENTS} anexos por projeto atingido. Remova um anexo antes de adicionar outro.`,
      statusCode: 400,
    };
  }

  return null;
}

async function decodeAndValidateMetadata(
  buffer: Buffer,
  detected: DetectedImageFormat
): Promise<AttachmentValidationResult> {
  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    const dimCheck = validateDimensions(width, height);
    if (!dimCheck.ok) {
      return { valid: false, error: dimCheck.error!, statusCode: 400 };
    }

    return {
      valid: true,
      format: detected,
      mimeType: formatMimeType(detected),
      width,
      height,
      sizeBytes: buffer.length,
    };
  } catch {
    return {
      valid: false,
      error: 'Falha ao decodificar imagem: arquivo corrompido ou malformado.',
      statusCode: 400,
    };
  }
}

export async function validateAttachmentBuffer(
  buffer: Buffer,
  options?: { currentAttachmentCount?: number }
): Promise<AttachmentValidationResult> {
  const preCheckError = validatePrechecks(buffer, options?.currentAttachmentCount);
  if (preCheckError) return preCheckError;

  const detected = detectImageFormatFromMagicBytes(buffer);
  if (!detected) {
    return {
      valid: false,
      error: 'Formato não suportado ou conteúdo adulterado. Formatos aceitos: PNG, JPEG e WebP.',
      statusCode: 415,
    };
  }

  return await decodeAndValidateMetadata(buffer, detected);
}
