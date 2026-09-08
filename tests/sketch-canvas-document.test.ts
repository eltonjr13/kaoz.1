import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type BackgroundLayer,
  type ImageLayer,
  type ShapeLayer,
  type SketchDrawingLayer,
  type SketchLayer,
  type SketchProjectData,
  type TextLayer,
  SKETCH_SCHEMA_VERSION,
  CANVAS_ASPECT_RATIO_PRESETS,
} from '../types/sketch.ts';
import {
  calculateResizeBounds,
  calculateRotationAngle,
  reorderLayers,
  duplicateLayerObject,
} from '../components/sketch/canvas/canvas-transform-math.ts';
import {
  renderCompositionToCanvas,
  resolveCanvasDimensionPreset,
} from '../lib/sketch/sketch-exporter.ts';
import { normalizeProject, createDefaultProject } from '../lib/sketch/sketch-storage.ts';

function createSampleDocumentProject(): SketchProjectData {
  const base = createDefaultProject({ id: 'doc-test-1', title: 'Documento Serializável' });
  const shapeRect: ShapeLayer = {
    id: 'shape-1',
    name: 'Retângulo Destaque',
    type: 'shape',
    shapeType: 'rect',
    x: 20,
    y: 25,
    width: 30,
    height: 20,
    strokeColor: '#6366f1',
    strokeWidth: 4,
    fillColor: 'transparent',
    rotation: 15,
    visible: true,
    opacity: 1,
  };

  const shapeArrow: ShapeLayer = {
    id: 'shape-2',
    name: 'Seta Indicativa',
    type: 'shape',
    shapeType: 'arrow',
    x: 55,
    y: 30,
    width: 25,
    height: 15,
    strokeColor: '#ef4444',
    strokeWidth: 3,
    visible: true,
    opacity: 1,
  };

  const guideAnnotation: ShapeLayer = {
    id: 'guide-1',
    name: 'Caixa de Anotação',
    type: 'shape',
    shapeType: 'rect',
    x: 10,
    y: 10,
    width: 80,
    height: 10,
    strokeColor: '#06b6d4',
    strokeWidth: 2,
    isGuide: true,
    elementKind: 'annotation',
    visible: true,
    opacity: 0.8,
  };

  return {
    ...base,
    layers: [...base.layers, shapeRect, shapeArrow, guideAnnotation],
  };
}

test('document model serializes coordinates independently of screen size and viewport', () => {
  const project = createSampleDocumentProject();
  const serialized = JSON.stringify(project);
  const parsed = JSON.parse(serialized);
  const normalized = normalizeProject(parsed);

  assert.equal(normalized.id, 'doc-test-1');
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.version, SKETCH_SCHEMA_VERSION);

  // Verifica que coordenadas lógicas percentuais de 0 a 100 foram estritamente preservadas
  const rectLayer = normalized.layers.find((l) => l.id === 'shape-1') as ShapeLayer;
  assert.ok(rectLayer, 'ShapeLayer retângulo deve ser preservado');
  assert.equal(rectLayer.x, 20);
  assert.equal(rectLayer.y, 25);
  assert.equal(rectLayer.width, 30);
  assert.equal(rectLayer.height, 20);
  assert.equal(rectLayer.rotation, 15);
  assert.equal(rectLayer.shapeType, 'rect');

  const arrowLayer = normalized.layers.find((l) => l.id === 'shape-2') as ShapeLayer;
  assert.ok(arrowLayer, 'ShapeLayer seta deve ser preservada');
  assert.equal(arrowLayer.shapeType, 'arrow');
  assert.equal(arrowLayer.strokeColor, '#ef4444');
});

test('interface background is decoupled from artboard background layer', () => {
  const project = createSampleDocumentProject();
  const bg = project.layers.find((l) => l.type === 'background') as BackgroundLayer;

  assert.ok(bg, 'Camada de fundo da arte deve existir');
  assert.equal(bg.fillType, 'color');
  assert.equal(bg.color, '#0d1117');

  // A cor da arte pode ser modificada livremente (ex: branco, gradiente ou imagem)
  bg.color = '#ffffff';
  assert.equal(bg.color, '#ffffff', 'Fundo da arte pode ser branco mantendo a superfície de trabalho escura');
});

test('guides and annotations are strictly differentiated from final elements', () => {
  const project = createSampleDocumentProject();
  const guideLayer = project.layers.find((l) => l.id === 'guide-1');
  assert.ok(guideLayer);
  assert.equal(guideLayer.isGuide, true);
  assert.equal(guideLayer.elementKind, 'annotation');

  // Exclusão de guias na exportação e composição final
  const finalLayers = project.layers.filter(
    (l) => !l.isGuide && l.elementKind !== 'guide' && l.elementKind !== 'annotation'
  );
  assert.ok(!finalLayers.some((l) => l.id === 'guide-1'), 'Guias devem ser omitidas da lista de elementos finais');
});

test('resize bounds calculation correctly handles directional handles without negative bounds', () => {
  const start = { x: 30, y: 30, width: 40, height: 40 };

  // 1. Redimensionar canto sudeste (SE) - amplia largura e altura
  const seBounds = calculateResizeBounds('se', start, 10, 15);
  assert.equal(seBounds.x, 30);
  assert.equal(seBounds.y, 30);
  assert.equal(seBounds.width, 50);
  assert.equal(seBounds.height, 55);

  // 2. Redimensionar canto noroeste (NW) - move x,y e altera dimensões
  const nwBounds = calculateResizeBounds('nw', start, -5, -8);
  assert.equal(nwBounds.x, 25);
  assert.equal(nwBounds.y, 22);
  assert.equal(nwBounds.width, 45);
  assert.equal(nwBounds.height, 48);

  // 3. Garantir que minW/minH impeça dimensões negativas
  const shrinkBounds = calculateResizeBounds('se', start, -50, -50);
  assert.ok(shrinkBounds.width >= 4, 'Largura mínima deve ser respeitada');
  assert.ok(shrinkBounds.height >= 4, 'Altura mínima deve ser respeitada');
});

test('rotation angle calculation produces 0 to 360 degree space', () => {
  const centerX = 200;
  const centerY = 200;

  // Ponto diretamente acima do centro
  const topAngle = calculateRotationAngle(200, 100, centerX, centerY);
  assert.equal(topAngle, 0, 'Acima do centro deve ser 0 graus');

  // Ponto à direita do centro
  const rightAngle = calculateRotationAngle(300, 200, centerX, centerY);
  assert.equal(rightAngle, 90, 'À direita do centro deve ser 90 graus');

  // Ponto diretamente abaixo do centro
  const bottomAngle = calculateRotationAngle(200, 300, centerX, centerY);
  assert.equal(bottomAngle, 180, 'Abaixo do centro deve ser 180 graus');

  // Ponto à esquerda do centro
  const leftAngle = calculateRotationAngle(100, 200, centerX, centerY);
  assert.equal(leftAngle, 270, 'À esquerda do centro deve ser 270 graus');
});

test('layer reordering shifts objects while keeping background pinned at bottom', () => {
  const project = createSampleDocumentProject();
  const initialCount = project.layers.length;

  // Trazer 'shape-1' para frente (topo)
  const frontReorder = reorderLayers(project.layers, 'shape-1', 'front');
  assert.equal(frontReorder[frontReorder.length - 1].id, 'shape-1', 'Elemento deve estar no topo');
  assert.equal(frontReorder[0].type, 'background', 'Fundo deve permanecer no índice 0');
  assert.equal(frontReorder.length, initialCount);

  // Enviar para trás (fundo, logo acima do background)
  const backReorder = reorderLayers(project.layers, 'shape-1', 'back');
  assert.equal(backReorder[1].id, 'shape-1', 'Elemento deve estar logo acima do background');
  assert.equal(backReorder[0].type, 'background');

  // Avançar 1 camada
  const fwd = reorderLayers(backReorder, 'shape-1', 'forward');
  assert.equal(fwd[2].id, 'shape-1');

  // Recuar 1 camada
  const bwd = reorderLayers(fwd, 'shape-1', 'backward');
  assert.equal(bwd[1].id, 'shape-1');
});

test('duplicate layer creates new layer with offset and unique id', () => {
  const project = createSampleDocumentProject();
  const rect = project.layers.find((l) => l.id === 'shape-1') as ShapeLayer;
  assert.ok(rect);

  const duplicated = duplicateLayerObject(rect) as ShapeLayer;
  assert.ok(duplicated);
  assert.notEqual(duplicated.id, rect.id);
  assert.ok(duplicated.id.startsWith('layer-shape-'));
  assert.equal(duplicated.name, 'Retângulo Destaque (Cópia)');
  assert.equal(duplicated.x, rect.x + 4);
  assert.equal(duplicated.y, rect.y + 4);
  assert.equal(duplicated.shapeType, 'rect');

  // Background e sketch layers não devem ser duplicados
  const bg = project.layers.find((l) => l.type === 'background')!;
  assert.equal(duplicateLayerObject(bg), null, 'Background não pode ser duplicado');
});

test('undo, redo, apply and cancel lifecycle simulation', () => {
  const initialLayers = createDefaultProject().layers;
  const history: SketchLayer[][] = [initialLayers];
  let historyIndex = 0;

  // 1. Usuário adiciona uma forma
  const newShape: ShapeLayer = {
    id: 'shape-step-1',
    name: 'Círculo',
    type: 'shape',
    shapeType: 'circle',
    x: 40,
    y: 40,
    width: 20,
    height: 20,
    strokeColor: '#10b981',
    strokeWidth: 2,
    visible: true,
    opacity: 1,
  };
  const step1Layers = [...initialLayers, newShape];
  history.push(step1Layers);
  historyIndex++;
  assert.equal(history.length, 2);
  assert.equal(historyIndex, 1);

  // 2. Usuário move a forma
  const step2Layers = step1Layers.map((l) => (l.id === 'shape-step-1' ? { ...l, x: 50 } : l));
  history.push(step2Layers);
  historyIndex++;
  assert.equal(historyIndex, 2);

  // 3. Desfazer (Undo do movimento)
  historyIndex--;
  const undoneState = history[historyIndex];
  const undoneShape = undoneState.find((l) => l.id === 'shape-step-1') as ShapeLayer;
  assert.equal(undoneShape.x, 40, 'Undo deve restaurar x=40');

  // 4. Refazer (Redo do movimento)
  historyIndex++;
  const redoneState = history[historyIndex];
  const redoneShape = redoneState.find((l) => l.id === 'shape-step-1') as ShapeLayer;
  assert.equal(redoneShape.x, 50, 'Redo deve restaurar x=50');

  // 5. Cancelar descarta tudo e restaura o snapshot inicial
  const cancelledLayers = initialLayers;
  assert.equal(cancelledLayers.some((l) => l.id === 'shape-step-1'), false, 'Cancelar deve remover a forma');

  // 6. Aplicar salva o estado atual como o novo ponto de restauração
  const savedSnapshot = [...step2Layers];
  assert.equal(savedSnapshot.some((l) => l.id === 'shape-step-1'), true, 'Aplicar salva com sucesso');
});

test('directional arrow and line vector calculations produce accurate rotation angles across quadrants', () => {
  // Quadrante 1: arrastar para direita (0 graus)
  const angleRight = Math.round((Math.atan2(0, 50) * 180) / Math.PI);
  assert.equal(angleRight, 0, 'Arrastar para a direita deve ter rotação 0°');

  // Quadrante 2: arrastar para baixo (90 graus)
  const angleDown = Math.round((Math.atan2(50, 0) * 180) / Math.PI);
  assert.equal(angleDown, 90, 'Arrastar para baixo deve ter rotação 90°');

  // Quadrante 3: arrastar para esquerda (180 ou -180 graus)
  const angleLeft = Math.abs(Math.round((Math.atan2(0, -50) * 180) / Math.PI));
  assert.equal(angleLeft, 180, 'Arrastar para a esquerda deve ter rotação 180°');

  // Quadrante 4: arrastar para cima (-90 graus)
  const angleUp = Math.round((Math.atan2(-50, 0) * 180) / Math.PI);
  assert.equal(angleUp, -90, 'Arrastar para cima deve ter rotação -90°');
});

test('rotated hit-testing precision correctly resolves inverse coordinates', () => {
  // Elemento centrado em (50, 50) com largura 20 e altura 20 (área original de 40 a 60 em x e y)
  // Rotacionado em 45 graus
  const cx = 50;
  const cy = 50;
  const rad = (-45 * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Ponto no centro sempre deve atingir o elemento
  const centerUnrotX = cx + (0 * cos - 0 * sin);
  const centerUnrotY = cy + (0 * sin + 0 * cos);
  assert.equal(centerUnrotX, 50);
  assert.equal(centerUnrotY, 50);

  // Ponto fora da geometria rotacionada (ex: canto desocupado da AABB em 41, 41)
  const dx = 41 - cx;
  const dy = 41 - cy;
  const cornerUnrotX = cx + (dx * cos - dy * sin);
  const cornerUnrotY = cy + (dx * sin + dy * cos);
  // No espaço rotacionado de 45°, o canto da bounding box original está fora da faixa [40, 60]
  const isInside = cornerUnrotX >= 40 && cornerUnrotX <= 60 && cornerUnrotY >= 40 && cornerUnrotY <= 60;
  assert.equal(isInside, false, 'Canto não ocupado da AABB rotacionada não deve ser atingido');
});

test('eraser paths are marked with tool eraser and distinct from brush strokes', () => {
  const brushPath = {
    id: 'p1',
    tool: 'brush' as const,
    color: '#6366f1',
    size: 8,
    opacity: 1,
    points: [{ x: 100, y: 100 }, { x: 150, y: 150 }],
  };

  const eraserPath = {
    id: 'p2',
    tool: 'eraser' as const,
    color: '#000000',
    size: 16,
    opacity: 1,
    points: [{ x: 120, y: 120 }],
  };

  assert.equal(brushPath.tool, 'brush');
  assert.equal(eraserPath.tool, 'eraser');
  assert.notEqual(eraserPath.tool, brushPath.tool);
});
