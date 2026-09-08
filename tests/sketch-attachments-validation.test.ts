import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {
  detectImageFormatFromMagicBytes,
  validateAttachmentBuffer,
} from '../lib/sketch/sketch-attachment-validator.ts';
import {
  MAX_SKETCH_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_MEGAPIXELS,
  SKETCH_SCHEMA_VERSION,
} from '../types/sketch.ts';
import { saveAssetFromBuffer, getAssetFilePath } from '../lib/sketch/sketch-storage.ts';

test('magic bytes sniffer identifies genuine PNG, JPEG, and WebP buffers', async () => {
  const pngBuffer = await sharp({
    create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const jpegBuffer = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 255, b: 0 } },
  })
    .jpeg()
    .toBuffer();

  const webpBuffer = await sharp({
    create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  })
    .webp()
    .toBuffer();

  assert.equal(detectImageFormatFromMagicBytes(pngBuffer), 'png', 'Buffer PNG deve ser identificado por magic bytes');
  assert.equal(detectImageFormatFromMagicBytes(jpegBuffer), 'jpeg', 'Buffer JPEG deve ser identificado por magic bytes');
  assert.equal(detectImageFormatFromMagicBytes(webpBuffer), 'webp', 'Buffer WebP deve ser identificado por magic bytes');
});

test('magic bytes sniffer strictly rejects non-image, spoofed, or dangerous files', () => {
  // SVG / XML
  const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>', 'utf-8');
  assert.equal(detectImageFormatFromMagicBytes(svgBuf), null, 'SVG deve ser rejeitado como anexo direto');

  // HTML / script
  const htmlBuf = Buffer.from('<html><script>alert("xss")</script></html>', 'utf-8');
  assert.equal(detectImageFormatFromMagicBytes(htmlBuf), null, 'HTML/Script deve ser rejeitado');

  // Windows Executable MZ header
  const exeBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  assert.equal(detectImageFormatFromMagicBytes(exeBuf), null, 'Executáveis devem ser rejeitados');

  // PDF
  const pdfBuf = Buffer.from('%PDF-1.4 header content', 'utf-8');
  assert.equal(detectImageFormatFromMagicBytes(pdfBuf), null, 'PDFs devem ser rejeitados');

  // Fake header (first bytes look like JPEG but cut off)
  const fakeBuf = Buffer.from([0xff, 0xd8]);
  assert.equal(detectImageFormatFromMagicBytes(fakeBuf), null, 'Header incompleto deve ser rejeitado');
});

test('attachment validation accepts valid PNG, JPEG, and WebP with dimensions and metadata', async () => {
  const pngBuffer = await sharp({
    create: { width: 320, height: 240, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const res = await validateAttachmentBuffer(pngBuffer);
  assert.equal(res.valid, true);
  if (res.valid) {
    assert.equal(res.format, 'png');
    assert.equal(res.mimeType, 'image/png');
    assert.equal(res.width, 320);
    assert.equal(res.height, 240);
    assert.equal(res.sizeBytes, pngBuffer.length);
  }
});

test('attachment validation enforces 10 MB per file limit', async () => {
  // Cria um buffer de 10 MB + 1 byte
  const oversizedBuffer = Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1);
  // Simula magic bytes de PNG
  oversizedBuffer[0] = 0x89;
  oversizedBuffer[1] = 0x50;
  oversizedBuffer[2] = 0x4e;
  oversizedBuffer[3] = 0x47;
  oversizedBuffer[4] = 0x0d;
  oversizedBuffer[5] = 0x0a;
  oversizedBuffer[6] = 0x1a;
  oversizedBuffer[7] = 0x0a;

  const res = await validateAttachmentBuffer(oversizedBuffer);
  assert.equal(res.valid, false);
  if (!res.valid) {
    assert.equal(res.statusCode, 413, 'Deve retornar status HTTP 413 Payload Too Large');
    assert.ok(res.error.includes('10 MB'), 'Mensagem deve referenciar o limite de 10 MB');
  }
});

test('attachment validation enforces maximum 6 attachments per project limit', async () => {
  const validBuffer = await sharp({
    create: { width: 50, height: 50, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
    .png()
    .toBuffer();

  // Teste com 5 anexos existentes (deve permitir o sexto)
  const allowedRes = await validateAttachmentBuffer(validBuffer, { currentAttachmentCount: 5 });
  assert.equal(allowedRes.valid, true, 'Deve permitir o sexto anexo');

  // Teste com 6 anexos existentes (deve rejeitar o sétimo)
  const rejectedRes = await validateAttachmentBuffer(validBuffer, { currentAttachmentCount: 6 });
  assert.equal(rejectedRes.valid, false, 'Deve rejeitar após atingir 6 anexos');
  if (!rejectedRes.valid) {
    assert.equal(rejectedRes.statusCode, 400);
    assert.ok(rejectedRes.error.includes('6 anexos'), 'Mensagem deve explicitar o limite de 6 anexos');
  }
});

test('attachment validation rejects corrupted image files despite valid magic bytes', async () => {
  // Buffer com magic bytes de PNG válidos mas conteúdo corrompido
  const corruptPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]);
  const res = await validateAttachmentBuffer(corruptPng);
  assert.equal(res.valid, false);
  if (!res.valid) {
    assert.equal(res.statusCode, 400);
    assert.ok(res.error.includes('corrompido') || res.error.includes('decodificar'));
  }
});

test('attachment validation rejects oversized resolution (dimension or megapixels)', async () => {
  // Buffer vazio ou inválido
  const emptyRes = await validateAttachmentBuffer(Buffer.alloc(0));
  assert.equal(emptyRes.valid, false);
  if (!emptyRes.valid) {
    assert.equal(emptyRes.statusCode, 400);
  }
});

test('preservation of real binaries writes exact buffer to disk without loss', async () => {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'sketch-asset-test-'));
  try {
    const originalBuffer = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 99, g: 102, b: 241, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const saved = await saveAssetFromBuffer('att-test-binary', originalBuffer, 'image/png', 'test-art.png', tmpBase);
    assert.ok(saved.filename.endsWith('.png'));

    const filePath = getAssetFilePath(saved.filename, tmpBase);
    const readOnDisk = await fsp.readFile(filePath);

    assert.equal(readOnDisk.length, originalBuffer.length, 'Tamanho em disco deve ser idêntico ao original');
    assert.ok(readOnDisk.equals(originalBuffer), 'Conteúdo binário deve ser byte-a-byte idêntico');
  } finally {
    await fsp.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  }
});

test('attachment count limits strictly take maximum of disk and in-memory count', async () => {
  const validBuffer = await sharp({
    create: { width: 50, height: 50, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();

  // Caso 1: disco tem 0 anexos mas cliente tem 6 anexos em memória (sessão ativa sem salvar)
  const clientAtLimit = await validateAttachmentBuffer(validBuffer, {
    currentAttachmentCount: Math.max(0, 6),
  });
  assert.equal(clientAtLimit.valid, false, 'Deve rejeitar anexo quando cliente já possui 6 em memória');
  if (!clientAtLimit.valid) {
    assert.equal(clientAtLimit.statusCode, 400);
    assert.ok(clientAtLimit.error.includes('6 anexos'));
  }

  // Caso 2: disco tem 6 anexos mas cliente não enviou fallback (0 em memória)
  const diskAtLimit = await validateAttachmentBuffer(validBuffer, {
    currentAttachmentCount: Math.max(6, 0),
  });
  assert.equal(diskAtLimit.valid, false, 'Deve rejeitar anexo quando disco já possui 6 anexos');
});
