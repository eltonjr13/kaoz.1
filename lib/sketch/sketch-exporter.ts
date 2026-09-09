import {
  ASPECT_RATIO_PRESETS,
  CANVAS_ASPECT_RATIO_PRESETS,
  resolveProviderAspectRatio,
  type AspectRatioDimension,
  type BackgroundLayer,
  type ExportCompositionOptions,
  type FlowSupportedAspectRatio,
  type ImageLayer,
  type ShapeLayer,
  type SketchCanvasAspectRatio,
  type SketchLayer,
  type SketchPath,
  type SketchProjectData,
  type TextLayer,
} from '../../types/sketch.ts';

declare global {
  interface Window {
    kaoz1Desktop?: {
      saveFile?: (payload: {
        defaultName: string;
        buffer: ArrayBuffer;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<{ savedPath?: string } | null>;
    };
  }
}

export async function waitForFontsReady(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready?.then === 'function') {
    try {
      await document.fonts.ready;
    } catch {
      // Graceful fallback for non-browser / headless environments
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${src}`));
    img.src = src;
  });
}

function computeContainDimensions(
  imgRatio: number,
  canvasRatio: number,
  width: number,
  height: number,
  offsetXPercent: number,
  offsetYPercent: number
): { renderW: number; renderH: number; offsetX: number; offsetY: number } {
  if (imgRatio > canvasRatio) {
    const renderW = width;
    const renderH = width / imgRatio;
    const offsetY = (height - renderH) * (offsetYPercent / 100);
    return { renderW, renderH, offsetX: 0, offsetY };
  }
  const renderH = height;
  const renderW = height * imgRatio;
  const offsetX = (width - renderW) * (offsetXPercent / 100);
  return { renderW, renderH, offsetX, offsetY: 0 };
}

function computeCoverDimensions(
  imgRatio: number,
  canvasRatio: number,
  width: number,
  height: number,
  offsetXPercent: number,
  offsetYPercent: number
): { renderW: number; renderH: number; offsetX: number; offsetY: number } {
  if (imgRatio > canvasRatio) {
    const renderW = height * imgRatio;
    const offsetX = (width - renderW) * (offsetXPercent / 100);
    return { renderW, renderH, offsetX, offsetY: 0 };
  }
  const renderH = width / imgRatio;
  const offsetY = (height - renderH) * (offsetYPercent / 100);
  return { renderW, renderH, offsetX: 0, offsetY };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  offsetXPercent = 50,
  offsetYPercent = 50,
  fit: 'cover' | 'contain' = 'cover'
) {
  const imgRatio = img.width / img.height;
  const canvasRatio = width / height;
  const { renderW, renderH, offsetX, offsetY } =
    fit === 'contain'
      ? computeContainDimensions(imgRatio, canvasRatio, width, height, offsetXPercent, offsetYPercent)
      : computeCoverDimensions(imgRatio, canvasRatio, width, height, offsetXPercent, offsetYPercent);

  ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
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

  const img = layer.fillType === 'image' && layer.imageUrl ? loadedImages.get(layer.imageUrl) : null;
  if (img) {
    if (layer.fit === 'contain' || layer.opacity < 1) {
      ctx.fillStyle = layer.color || '#0d1117';
      ctx.fillRect(0, 0, width, height);
    }
    const offX = typeof layer.offsetX === 'number' ? layer.offsetX : 50;
    const offY = typeof layer.offsetY === 'number' ? layer.offsetY : 50;
    drawCoverImage(ctx, img, width, height, offX, offY, layer.fit || 'cover');
  } else {
    ctx.fillStyle = layer.color || '#0d1117';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
}

function drawBoxPath(ctx: CanvasRenderingContext2D, path: SketchPath, scaleX: number, scaleY: number) {
  if (!path.boxRect) return;
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
}

function drawStrokePath(ctx: CanvasRenderingContext2D, path: SketchPath, scaleX: number, scaleY: number) {
  if (path.points.length === 0) return;
  if (path.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = path.color;
  }
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
  ctx.globalCompositeOperation = 'source-over';
}

function drawSketchPath(ctx: CanvasRenderingContext2D, path: SketchPath, scaleX: number, scaleY: number) {
  ctx.save();
  ctx.globalAlpha = path.opacity;

  if (path.tool === 'box') {
    drawBoxPath(ctx, path, scaleX, scaleY);
  } else {
    drawStrokePath(ctx, path, scaleX, scaleY);
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

function computeTextBgX(textAlign: string, posX: number, bgW: number, padding: number): number {
  if (textAlign === 'center') return posX - bgW / 2;
  if (textAlign === 'right') return posX - bgW + padding;
  return posX - padding;
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
  const bgX = computeTextBgX(layer.textAlign || 'left', posX, bgW, padding);
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

function computeMaxLineWidth(ctx: CanvasRenderingContext2D, lines: string[]): number {
  let maxWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxWidth) maxWidth = w;
  }
  return maxWidth;
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

  const maxLineWidth = computeMaxLineWidth(ctx, lines);
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

function renderSketchDrawingLayer(
  ctx: CanvasRenderingContext2D,
  layer: import('../../types/sketch.ts').SketchDrawingLayer,
  preset: AspectRatioDimension,
  excludeGuides: boolean
) {
  const scaleX = preset.width / 1080;
  const scaleY = preset.height / 1080;
  let offCanvas: HTMLCanvasElement | null = null;
  let drawCtx = ctx;

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    offCanvas = document.createElement('canvas');
    offCanvas.width = preset.width;
    offCanvas.height = preset.height;
    const oCtx = offCanvas.getContext('2d');
    if (oCtx) drawCtx = oCtx;
  }

  for (const path of layer.paths) {
    if (excludeGuides && path.isGuide) continue;
    drawSketchPath(drawCtx, path, scaleX, scaleY);
  }

  if (offCanvas && drawCtx !== ctx) {
    ctx.drawImage(offCanvas, 0, 0);
  }
}

export function resolveCanvasDimensionPreset(project: SketchProjectData): AspectRatioDimension {
  const canvasRatio: SketchCanvasAspectRatio = project.canvasAspectRatio || project.aspectRatio || '1:1';
  const basePreset = CANVAS_ASPECT_RATIO_PRESETS[canvasRatio] || ASPECT_RATIO_PRESETS['1:1'];
  if (canvasRatio === 'custom' && project.canvasDimensions?.width && project.canvasDimensions?.height) {
    return {
      width: project.canvasDimensions.width,
      height: project.canvasDimensions.height,
      label: basePreset.label,
      description: basePreset.description,
    };
  }
  return basePreset;
}

function drawArrowShape(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeColor: string,
  lineWidth: number
) {
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const headAngle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, lineWidth * 3);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(headAngle - Math.PI / 6),
    y2 - headLen * Math.sin(headAngle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(headAngle + Math.PI / 6),
    y2 - headLen * Math.sin(headAngle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function drawRectShape(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strokeColor: string,
  lineWidth: number,
  fillColor?: string
) {
  if (fillColor && fillColor !== 'transparent') {
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, 0, w, h);
  }
  if (lineWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(0, 0, w, h);
  }
}

function drawCircleShape(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strokeColor: string,
  lineWidth: number,
  fillColor?: string
) {
  const rx = w / 2;
  const ry = h / 2;
  ctx.beginPath();
  ctx.ellipse(rx, ry, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  if (fillColor && fillColor !== 'transparent') {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (lineWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawLineShape(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeColor: string,
  lineWidth: number
) {
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawLineOrArrowShape(
  ctx: CanvasRenderingContext2D,
  layer: ShapeLayer,
  shapeW: number,
  shapeH: number,
  lineWidth: number
) {
  const isHoriz = layer.rotation !== undefined || layer.height <= 8;
  const y1 = isHoriz ? shapeH / 2 : 0;
  const y2 = isHoriz ? shapeH / 2 : shapeH;
  if (layer.shapeType === 'arrow') {
    drawArrowShape(ctx, 0, y1, shapeW, y2, layer.strokeColor, lineWidth);
  } else {
    drawLineShape(ctx, 0, y1, shapeW, y2, layer.strokeColor, lineWidth);
  }
}

function renderShapeContent(
  ctx: CanvasRenderingContext2D,
  layer: ShapeLayer,
  shapeW: number,
  shapeH: number,
  lineWidth: number
) {
  if (layer.shapeType === 'circle') {
    drawCircleShape(ctx, shapeW, shapeH, layer.strokeColor, lineWidth, layer.fillColor);
  } else if (layer.shapeType === 'rect') {
    drawRectShape(ctx, shapeW, shapeH, layer.strokeColor, lineWidth, layer.fillColor);
  } else {
    drawLineOrArrowShape(ctx, layer, shapeW, shapeH, lineWidth);
  }
}

function drawShapeLayer(
  ctx: CanvasRenderingContext2D,
  layer: ShapeLayer,
  width: number,
  height: number
) {
  if (!layer.visible) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity;

  const posX = (layer.x / 100) * width;
  const posY = (layer.y / 100) * height;
  const shapeW = (layer.width / 100) * width;
  const shapeH = (layer.height / 100) * height;
  const lineWidth = Math.max(1, (layer.strokeWidth / 1080) * width);

  ctx.translate(posX + shapeW / 2, posY + shapeH / 2);
  if (layer.rotation) {
    ctx.rotate((layer.rotation * Math.PI) / 180);
  }
  ctx.translate(-shapeW / 2, -shapeH / 2);

  renderShapeContent(ctx, layer, shapeW, shapeH, lineWidth);

  ctx.restore();
}

function isGuideOrAnnotation(layer: SketchLayer): boolean {
  return Boolean(layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation');
}

function dispatchLayerDraw(
  ctx: CanvasRenderingContext2D,
  layer: SketchLayer,
  preset: AspectRatioDimension,
  loadedImages: Map<string, HTMLImageElement>,
  excludeGuides: boolean
) {
  if (layer.type === 'background') {
    drawBackgroundLayer(ctx, layer, preset.width, preset.height, loadedImages);
  } else if (layer.type === 'sketch' && layer.visible) {
    renderSketchDrawingLayer(ctx, layer, preset, excludeGuides);
  } else if (layer.type === 'image') {
    drawImageLayer(ctx, layer, preset.width, preset.height, loadedImages);
  } else if (layer.type === 'text') {
    drawTextLayer(ctx, layer, preset.width, preset.height);
  } else if (layer.type === 'shape') {
    drawShapeLayer(ctx, layer as ShapeLayer, preset.width, preset.height);
  }
}

function renderSingleLayer(
  ctx: CanvasRenderingContext2D,
  layer: SketchLayer,
  preset: AspectRatioDimension,
  loadedImages: Map<string, HTMLImageElement>,
  excludeGuides = false
) {
  if (layer.exportToProvider === false) return;
  if (excludeGuides && isGuideOrAnnotation(layer)) return;
  dispatchLayerDraw(ctx, layer, preset, loadedImages, excludeGuides);
}

export async function renderCompositionToCanvas(
  project: SketchProjectData,
  canvas?: HTMLCanvasElement,
  options?: { excludeGuides?: boolean }
): Promise<HTMLCanvasElement> {
  const targetCanvas = canvas || document.createElement('canvas');
  const preset = resolveCanvasDimensionPreset(project);
  targetCanvas.width = preset.width;
  targetCanvas.height = preset.height;

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível inicializar o contexto 2D.');

  const loadedImages = await preloadProjectImages(project);
  const excludeGuides = options ? Boolean(options.excludeGuides) : false;

  for (const layer of project.layers) {
    renderSingleLayer(ctx, layer, preset, loadedImages, excludeGuides);
  }

  return targetCanvas;
}

function shouldSkipLayerForComposite(
  layer: SketchLayer,
  excludeGuides: boolean,
  excludeText: boolean
): boolean {
  if (!layer.visible) return true;
  if (layer.exportToProvider === false) return true;
  if (excludeGuides && isGuideOrAnnotation(layer)) return true;
  if (excludeText && layer.type === 'text') return true;
  return false;
}

export interface RenderCompositeOptions {
  excludeGuides?: boolean;
  excludeText?: boolean;
  targetAspectRatio?: FlowSupportedAspectRatio;
}

const FALLBACK_COMPOSITE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function resolveCompositeTargetRatio(
  project: SketchProjectData,
  targetAspectRatio?: FlowSupportedAspectRatio
): FlowSupportedAspectRatio {
  if (targetAspectRatio) return targetAspectRatio;
  const ratio = project.canvasAspectRatio || project.aspectRatio;
  const dims = project.canvasDimensions;
  return resolveProviderAspectRatio(ratio, dims?.width, dims?.height);
}

function renderLayersToCompositeCanvas(
  ctx: CanvasRenderingContext2D,
  layers: SketchLayer[],
  preset: AspectRatioDimension,
  loadedImages: Map<string, HTMLImageElement>,
  excludeGuides: boolean,
  excludeText: boolean
): void {
  for (const layer of layers) {
    if (shouldSkipLayerForComposite(layer, excludeGuides, excludeText)) continue;
    renderSingleLayer(ctx, layer, preset, loadedImages, excludeGuides);
  }
}

export async function renderCompositeReferenceDataUrl(
  project: SketchProjectData,
  options: RenderCompositeOptions = { excludeGuides: true, excludeText: true }
): Promise<string> {
  if (typeof document === 'undefined') {
    return FALLBACK_COMPOSITE_PNG;
  }
  const targetRatio = resolveCompositeTargetRatio(project, options.targetAspectRatio);
  const preset = ASPECT_RATIO_PRESETS[targetRatio] || ASPECT_RATIO_PRESETS['1:1'];

  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return FALLBACK_COMPOSITE_PNG;

  const loadedImages = await preloadProjectImages(project);
  const excludeGuides = options.excludeGuides !== false;
  const excludeText = options.excludeText !== false;

  renderLayersToCompositeCanvas(ctx, project.layers, preset, loadedImages, excludeGuides, excludeText);
  return canvas.toDataURL('image/png');
}

export function renderSketchOnlyDataUrl(paths: SketchPath[], width = 1080, height = 1080): string {
  if (typeof document === 'undefined') {
    return FALLBACK_COMPOSITE_PNG;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return FALLBACK_COMPOSITE_PNG;

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
