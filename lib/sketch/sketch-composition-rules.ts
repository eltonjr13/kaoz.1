import type {
  ImageLayer,
  ShapeLayer,
  SketchLayer,
  TextLayer,
} from '../../types/sketch.ts';

export const SKETCH_BASE_WIDTH = 1080;

export interface LayerBoxMetrics {
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  actualFontSize: number;
  padding: number;
  borderRadius: number;
  strokeWidth: number;
  rotation: number;
}

export interface ObjectContainFit {
  drawW: number;
  drawH: number;
  drawX: number;
  drawY: number;
}

export interface TextRenderPositions {
  lines: string[];
  lineHeight: number;
  totalTextHeight: number;
  totalBoxHeight: number;
  textStartX: number;
  textStartY: number;
  bgX: number;
  bgY: number;
  bgWidth: number;
  bgHeight: number;
  textAlign: 'left' | 'center' | 'right';
}

export function resolveArtboardDisplayScale(
  artboardWidth: number,
  baseWidth = SKETCH_BASE_WIDTH
): number {
  if (!artboardWidth || artboardWidth <= 0) return 1;
  return artboardWidth / baseWidth;
}

function resolveLayerDimensionsMetrics(
  layer: SketchLayer,
  targetWidth: number,
  targetHeight: number
): { boxX: number; boxY: number; boxWidth: number; boxHeight: number; rotation: number } {
  const l = layer as ImageLayer | TextLayer | ShapeLayer;
  const boxX = (l.x / 100) * targetWidth;
  const boxY = (l.y / 100) * targetHeight;
  const boxWidth = Math.max(1, (l.width / 100) * targetWidth);
  const defaultHeight = layer.type === 'text' ? 12 : 30;
  const heightPct = typeof l.height === 'number' && l.height > 0 ? l.height : defaultHeight;
  const boxHeight = (heightPct / 100) * targetHeight;
  return { boxX, boxY, boxWidth, boxHeight, rotation: l.rotation || 0 };
}

function resolveTextStylingMetrics(
  layer: SketchLayer,
  scale: number
): { actualFontSize: number; padding: number; borderRadius: number } {
  if (layer.type !== 'text') {
    return { actualFontSize: 16 * scale, padding: 0, borderRadius: 0 };
  }
  const t = layer as TextLayer;
  return {
    actualFontSize: Math.max(10, t.fontSize * scale),
    padding: t.backgroundPadding ? t.backgroundPadding * scale : 0,
    borderRadius: t.borderRadius ? t.borderRadius * scale : 0,
  };
}

function resolveShapeStrokeWidth(layer: SketchLayer, scale: number): number {
  if (layer.type !== 'shape') return 1 * scale;
  const s = layer as ShapeLayer;
  return Math.max(1, s.strokeWidth * scale);
}

export function resolveLayerBoxMetrics(
  layer: SketchLayer,
  targetWidth: number,
  targetHeight: number,
  baseWidth = SKETCH_BASE_WIDTH
): LayerBoxMetrics {
  const scale = targetWidth / baseWidth;
  const dims = resolveLayerDimensionsMetrics(layer, targetWidth, targetHeight);
  const textStyles = resolveTextStylingMetrics(layer, scale);
  const strokeWidth = resolveShapeStrokeWidth(layer, scale);

  return {
    ...dims,
    ...textStyles,
    strokeWidth,
  };
}

export function fallbackMeasureTextWidth(
  text: string,
  fontSize: number,
  fontWeight = '400'
): number {
  const isBold = fontWeight === '700' || fontWeight === '800' || fontWeight === '900' || fontWeight === 'bold';
  const widthPerChar = fontSize * (isBold ? 0.58 : 0.52);
  return text.length * widthPerChar;
}

function breakOversizedWord(
  word: string,
  maxWidth: number,
  measureFn: (str: string) => number
): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const char of word) {
    const candidate = current + char;
    if (current && measureFn(candidate) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [word];
}

function processWordsIntoWrappedLines(
  words: string[],
  maxWidth: number,
  measureFn: (str: string) => number
): string[] {
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;
    if (measureFn(word) > maxWidth) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      const brokenChunks = breakOversizedWord(word, maxWidth, measureFn);
      lines.push(...brokenChunks.slice(0, -1));
      currentLine = brokenChunks[brokenChunks.length - 1];
      continue;
    }

    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (measureFn(candidate) <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

export function wrapTextLines(
  text: string,
  maxWidth: number,
  measureFn: (str: string) => number
): string[] {
  if (!text) return [];
  const safeMaxWidth = Math.max(10, maxWidth);
  const rawParagraphs = text.split('\n');
  const allLines: string[] = [];

  for (const para of rawParagraphs) {
    if (!para.trim()) {
      allLines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    const wrapped = processWordsIntoWrappedLines(words, safeMaxWidth, measureFn);
    allLines.push(...wrapped);
  }

  return allLines.length > 0 ? allLines : [''];
}

function resolveTextAlignX(
  textAlign: 'left' | 'center' | 'right',
  boxX: number,
  boxWidth: number,
  padding: number
): number {
  if (textAlign === 'center') return boxX + boxWidth / 2;
  if (textAlign === 'right') return boxX + boxWidth - padding;
  return boxX + padding;
}

export function computeTextPositions(
  layer: TextLayer,
  lines: string[],
  metrics: LayerBoxMetrics,
  targetHeight: number
): TextRenderPositions {
  const textAlign = layer.textAlign || 'left';
  const lineHeight = metrics.actualFontSize * 1.25;
  const totalTextHeight = lines.length * lineHeight;
  const paddingY = layer.backgroundColor && layer.backgroundColor !== 'transparent' ? metrics.padding : 0;
  const totalBoxHeight = Math.max(
    layer.height ? (layer.height / 100) * targetHeight : 0,
    totalTextHeight + paddingY * 2
  );

  const textStartX = resolveTextAlignX(textAlign, metrics.boxX, metrics.boxWidth, metrics.padding);
  const textStartY = metrics.boxY + paddingY + lineHeight * 0.5;

  return {
    lines,
    lineHeight,
    totalTextHeight,
    totalBoxHeight,
    textStartX,
    textStartY,
    bgX: metrics.boxX,
    bgY: metrics.boxY,
    bgWidth: metrics.boxWidth,
    bgHeight: totalBoxHeight,
    textAlign,
  };
}

export function computeObjectContainFit(
  imgWidth: number,
  imgHeight: number,
  boxWidth: number,
  boxHeight: number
): ObjectContainFit {
  if (!imgWidth || !imgHeight || imgWidth <= 0 || imgHeight <= 0) {
    return { drawW: boxWidth, drawH: boxHeight, drawX: 0, drawY: 0 };
  }
  const imgRatio = imgWidth / imgHeight;
  const boxRatio = boxWidth / boxHeight;

  if (imgRatio > boxRatio) {
    const drawW = boxWidth;
    const drawH = boxWidth / imgRatio;
    const drawY = (boxHeight - drawH) / 2;
    return { drawW, drawH, drawX: 0, drawY };
  }

  const drawH = boxHeight;
  const drawW = boxHeight * imgRatio;
  const drawX = (boxWidth - drawW) / 2;
  return { drawW, drawH, drawX, drawY: 0 };
}

function isGuideOrAnnotationLayer(layer: SketchLayer): boolean {
  return Boolean(
    layer.isGuide ||
      layer.elementKind === 'guide' ||
      layer.elementKind === 'annotation'
  );
}

export function isLayerIncludedInFinalExport(
  layer: SketchLayer,
  options?: { includeSketches?: boolean }
): boolean {
  if (!layer.visible) return false;
  if (layer.includeInFinalExport === false) return false;
  if (layer.includeInFinalExport === true) return true;
  if (layer.elementKind === 'final') return true;
  if (isGuideOrAnnotationLayer(layer)) return false;

  if (layer.type === 'sketch') {
    return Boolean(options?.includeSketches);
  }

  return true;
}

export function isLayerIncludedInProviderReference(
  layer: SketchLayer,
  excludeGuides = true,
  excludeText = true
): boolean {
  if (!layer.visible) return false;
  if (layer.exportToProvider === false) return false;
  if (excludeGuides && isGuideOrAnnotationLayer(layer)) return false;
  if (excludeText && layer.type === 'text') return false;
  return true;
}
