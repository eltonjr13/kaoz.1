import {
  ASPECT_RATIO_PRESETS,
  type BackgroundLayer,
  type ImageLayer,
  type SketchPath,
  type SketchProjectData,
  type TextLayer,
} from '../../types/sketch.ts';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${src}`));
    img.src = src;
  });
}

function drawBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  layer: BackgroundLayer,
  width: number,
  height: number,
  loadedImages: Map<string, HTMLImageElement>
) {
  if (!layer.visible) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity;

  if (layer.fillType === 'image' && layer.imageUrl) {
    const img = loadedImages.get(layer.imageUrl);
    if (img) {
      // Cover fit
      const imgRatio = img.width / img.height;
      const canvasRatio = width / height;
      let renderW = width;
      let renderH = height;
      let offsetX = 0;
      let offsetY = 0;

      if (imgRatio > canvasRatio) {
        renderW = height * imgRatio;
        offsetX = (width - renderW) / 2;
      } else {
        renderH = width / imgRatio;
        offsetY = (height - renderH) / 2;
      }
      ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
    } else {
      ctx.fillStyle = layer.color || '#090a0f';
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    ctx.fillStyle = layer.color || '#0d1117';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
}

function drawSketchPath(ctx: CanvasRenderingContext2D, path: SketchPath, scaleX: number, scaleY: number) {
  if (path.points.length === 0 && !path.boxRect) return;
  ctx.save();
  ctx.globalAlpha = path.opacity;

  if (path.tool === 'box' && path.boxRect) {
    const rx = path.boxRect.x * scaleX;
    const ry = path.boxRect.y * scaleY;
    const rw = path.boxRect.width * scaleX;
    const rh = path.boxRect.height * scaleY;

    ctx.strokeStyle = path.color || '#6366f1';
    ctx.lineWidth = Math.max(2, path.size * scaleX);
    ctx.strokeRect(rx, ry, rw, rh);

    if (path.boxLabel) {
      ctx.fillStyle = path.color || '#6366f1';
      ctx.font = `600 ${Math.max(14, 16 * scaleX)}px sans-serif`;
      ctx.fillText(path.boxLabel, rx + 8, ry + 24);
    }
  } else if (path.points.length > 0) {
    ctx.strokeStyle = path.tool === 'eraser' ? '#ffffff' : path.color;
    ctx.lineWidth = Math.max(1, path.size * scaleX);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const first = path.points[0];
    ctx.moveTo(first.x * scaleX, first.y * scaleY);
    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i];
      ctx.lineTo(p.x * scaleX, p.y * scaleY);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  width: number,
  height: number,
  loadedImages: Map<string, HTMLImageElement>
) {
  if (!layer.visible || !layer.imageUrl) return;
  const img = loadedImages.get(layer.imageUrl);
  if (!img) return;

  ctx.save();
  ctx.globalAlpha = layer.opacity;

  const posX = (layer.x / 100) * width;
  const posY = (layer.y / 100) * height;
  const targetW = (layer.width / 100) * width;
  const targetH = (layer.height / 100) * height;

  if (layer.rotation) {
    ctx.translate(posX + targetW / 2, posY + targetH / 2);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
  } else {
    ctx.drawImage(img, posX, posY, targetW, targetH);
  }

  ctx.restore();
}

function drawTextBackground(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  posX: number,
  posY: number,
  metrics: { textWidth: number; totalHeight: number; actualFontSize: number },
  padding: number
) {
  if (!layer.backgroundColor || layer.backgroundColor === 'transparent') return;
  const radius = layer.borderRadius ?? 8;
  const bgW = metrics.textWidth + padding * 2;
  const bgH = metrics.totalHeight + padding * 2;
  let bgX = posX - padding;

  if (layer.textAlign === 'center') {
    bgX = posX - bgW / 2;
  } else if (layer.textAlign === 'right') {
    bgX = posX - bgW + padding;
  }

  const bgY = posY - padding - metrics.actualFontSize * 0.8;

  ctx.save();
  ctx.fillStyle = layer.backgroundColor;
  ctx.beginPath();
  ctx.roundRect(bgX, bgY, bgW, bgH, radius);
  ctx.fill();
  ctx.restore();
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  posX: number,
  posY: number,
  actualFontSize: number,
  color: string
) {
  ctx.fillStyle = color;
  const lineHeight = actualFontSize * 1.25;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], posX, posY + i * lineHeight);
  }
}

function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer, width: number, height: number) {
  if (!layer.visible || !layer.text.trim()) return;

  ctx.save();
  ctx.globalAlpha = layer.opacity;

  const actualFontSize = Math.max(12, (layer.fontSize / 1080) * width);
  ctx.font = `${layer.fontWeight || '700'} ${actualFontSize}px ${layer.fontFamily || 'sans-serif'}`;
  ctx.textAlign = layer.textAlign || 'left';
  ctx.textBaseline = 'middle';

  const processedText = layer.textTransform === 'uppercase' ? layer.text.toUpperCase() : layer.text;
  const lines = processedText.split('\n');
  const posX = (layer.x / 100) * width;
  const posY = (layer.y / 100) * height;
  const padding = layer.backgroundPadding ? (layer.backgroundPadding / 1080) * width : 12;

  let maxLineWidth = 0;
  for (const line of lines) {
    const lineW = ctx.measureText(line).width;
    if (lineW > maxLineWidth) maxLineWidth = lineW;
  }

  const totalHeight = lines.length * actualFontSize * 1.25;
  drawTextBackground(ctx, layer, posX, posY, { textWidth: maxLineWidth, totalHeight, actualFontSize }, padding);
  drawTextLines(ctx, lines, posX, posY, actualFontSize, layer.color || '#ffffff');

  ctx.restore();
}

export async function preloadProjectImages(project: SketchProjectData): Promise<Map<string, HTMLImageElement>> {
  const imageMap = new Map<string, HTMLImageElement>();
  const urlsToLoad = new Set<string>();

  for (const layer of project.layers) {
    if (layer.type === 'background' && layer.imageUrl) {
      urlsToLoad.add(layer.imageUrl);
    } else if (layer.type === 'image' && layer.imageUrl) {
      urlsToLoad.add(layer.imageUrl);
    }
  }

  const promises = Array.from(urlsToLoad).map(async (url) => {
    try {
      const img = await loadImage(url);
      imageMap.set(url, img);
    } catch {
      // Ignorar falhas de carregamento silenciosamente
    }
  });

  await Promise.all(promises);
  return imageMap;
}

export async function renderCompositionToCanvas(
  project: SketchProjectData,
  canvas?: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  const targetCanvas = canvas || document.createElement('canvas');
  const preset = ASPECT_RATIO_PRESETS[project.aspectRatio] || ASPECT_RATIO_PRESETS['1:1'];
  targetCanvas.width = preset.width;
  targetCanvas.height = preset.height;

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível inicializar o contexto 2D.');

  const loadedImages = await preloadProjectImages(project);

  for (const layer of project.layers) {
    if (layer.type === 'background') {
      drawBackgroundLayer(ctx, layer, preset.width, preset.height, loadedImages);
    } else if (layer.type === 'sketch' && layer.visible) {
      const scaleX = preset.width / 1080;
      const scaleY = preset.height / 1080;
      for (const path of layer.paths) {
        drawSketchPath(ctx, path, scaleX, scaleY);
      }
    } else if (layer.type === 'image') {
      drawImageLayer(ctx, layer, preset.width, preset.height, loadedImages);
    } else if (layer.type === 'text') {
      drawTextLayer(ctx, layer, preset.width, preset.height);
    }
  }

  return targetCanvas;
}

export function renderSketchOnlyDataUrl(paths: SketchPath[], width = 1080, height = 1080): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background branco limpo para o FlowProvider interpretar o rascunho com clareza
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const scaleX = width / 1080;
  const scaleY = height / 1080;
  for (const path of paths) {
    drawSketchPath(ctx, path, scaleX, scaleY);
  }

  return canvas.toDataURL('image/png');
}

export async function exportCompositionBlob(
  project: SketchProjectData,
  format: 'png' | 'jpeg' = 'png',
  quality = 0.95
): Promise<Blob> {
  const canvas = await renderCompositionToCanvas(project);
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao gerar blob do canvas'));
      },
      mimeType,
      quality
    );
  });
}

export async function exportCompositionDataUrl(
  project: SketchProjectData,
  format: 'png' | 'jpeg' = 'png',
  quality = 0.95
): Promise<string> {
  const canvas = await renderCompositionToCanvas(project);
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return canvas.toDataURL(mimeType, quality);
}

export async function downloadComposition(
  project: SketchProjectData,
  format: 'png' | 'jpeg' = 'png',
  filename?: string
): Promise<void> {
  const blob = await exportCompositionBlob(project, format);
  const url = URL.createObjectURL(blob);
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const name = filename || `anuncio-${project.title.toLowerCase().replace(/\s+/g, '-') || 'sketch'}-${Date.now()}.${ext}`;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
