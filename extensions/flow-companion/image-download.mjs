import { allowedImage } from './protocol.mjs';

export async function imageData(url) {
  if (!allowedImage(url)) throw new Error('Origem da imagem não permitida.');
  const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(25000) });
  if (!response.ok || !allowedImage(response.url)) throw new Error('Não foi possível baixar a imagem original do Flow.');
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('O resultado não é PNG, JPEG ou WebP.');
  const chunks = await readChunks(response.body);
  let binary = '';
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += 8192) binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
  }
  return { dataUrl: `data:${mime};base64,${btoa(binary)}`, bytes: binary.length, mime };
}

async function readChunks(body) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 12 * 1024 * 1024) { await reader.cancel(); throw new Error('Imagem excede 12 MB.'); }
    chunks.push(value);
  }
  return chunks;
}
