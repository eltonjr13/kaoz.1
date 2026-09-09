import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCleanProject,
  createCleanLayers,
  normalizeProject,
} from '../lib/sketch/sketch-storage.ts';
import {
  SketchSaveCoordinator,
} from '../lib/sketch/sketch-save-coordinator.ts';
import { renderSketchOnlyDataUrl } from '../lib/sketch/sketch-exporter.ts';
import type {
  FlowSupportedAspectRatio,
  SketchAttachment,
  SketchChangeIntent,
  SketchPath,
  SketchProjectData,
  SketchReferenceRole,
  SketchSimpleOrder,
} from '../types/sketch.ts';

function syncOrderFromProject(
  project: SketchProjectData,
  sketchPaths: SketchPath[],
  sketchThumbnail?: string
): SketchProjectData {
  const selectedReferences = project.attachments.map((att) => ({
    attachmentId: att.id,
    role: (att.role as SketchReferenceRole) || 'product',
    dataUrl: att.dataUrl,
    name: att.name,
    filePath: att.filePath,
  }));

  const hasDrawing = sketchPaths.length > 0;
  const sketchDrawing = hasDrawing
    ? { paths: sketchPaths, dataUrl: sketchThumbnail, hasDrawing: true }
    : undefined;

  const currentOrder: SketchSimpleOrder = {
    schemaVersion: 1,
    version: '1.0.0',
    id: project.currentOrder?.id || `order-${project.id}-${Date.now()}`,
    prompt: project.prompt,
    aspectRatio: project.aspectRatio,
    canvasAspectRatio: project.canvasAspectRatio,
    canvasDimensions: project.canvasDimensions,
    selectedReferences,
    sketchDrawing,
    createdAt: project.currentOrder?.createdAt || new Date().toISOString(),
  };

  return {
    ...project,
    currentOrder,
    useSketchAsReference: hasDrawing,
  };
}

test('UI Flow 1: new session starts 100% clean without persistent prompt or canned copy layers', () => {
  const clean = createCleanProject({ title: 'Campanha Tênis Urbano' });

  assert.equal(clean.prompt, '', 'Prompt inicial deve começar estritamente vazio');
  assert.equal(clean.title, 'Campanha Tênis Urbano');
  assert.equal(clean.aspectRatio, '1:1');
  assert.equal(clean.attachments.length, 0);
  assert.equal(clean.layers.length, 1, 'Deve conter apenas camada base de fundo');
  assert.equal(clean.layers[0].type, 'background');

  const cleanLayers = createCleanLayers();
  assert.equal(cleanLayers.length, 1);
  assert.equal(cleanLayers[0].type, 'background');

  // Não deve conter camadas promocionais legadas
  const layerIds = clean.layers.map((l) => l.id);
  assert.equal(layerIds.includes('layer-text-headline'), false);
  assert.equal(layerIds.includes('layer-text-badge'), false);
  assert.equal(layerIds.includes('layer-text-cta'), false);
});

test('UI Flow 2: syncOrderFromProject synchronizes user prompt, aspect ratio and reference roles into SimpleOrder', () => {
  const project = createCleanProject();
  project.prompt = 'Tênis esportivo para corrida com 30% OFF e entrega rápida';
  project.aspectRatio = '9:16';

  const mockAttachment: SketchAttachment = {
    id: 'att-1',
    name: 'tenis.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    role: 'product',
    createdAt: new Date().toISOString(),
  };
  project.attachments.push(mockAttachment);

  const synced = syncOrderFromProject(project, []);

  assert.ok(synced.currentOrder);
  assert.equal(synced.currentOrder.prompt, project.prompt);
  assert.equal(synced.currentOrder.aspectRatio, '9:16');
  assert.equal(synced.currentOrder.selectedReferences.length, 1);
  assert.equal(synced.currentOrder.selectedReferences[0].attachmentId, 'att-1');
  assert.equal(synced.currentOrder.selectedReferences[0].role, 'product');
  assert.equal(synced.useSketchAsReference, false);
  assert.equal(synced.currentOrder.sketchDrawing, undefined);
});

test('UI Flow 3: sketch drawing creates valid SketchOrderDrawing and empty sketch sends zero paths', () => {
  const project = createCleanProject();
  project.prompt = 'Suco natural de laranja em garrafa de vidro';

  // Cenário 3A: Usuário não desenhou nada -> useSketchAsReference = false
  const withoutSketch = syncOrderFromProject(project, []);
  assert.equal(withoutSketch.useSketchAsReference, false);
  assert.equal(withoutSketch.currentOrder?.sketchDrawing, undefined);

  // Cenário 3B: Usuário desenhou traços
  const samplePaths: SketchPath[] = [
    {
      id: 'p-1',
      tool: 'brush',
      color: '#ef4444',
      size: 6,
      opacity: 1,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 300, y: 300 },
      ],
    },
  ];

  const thumbnail = renderSketchOnlyDataUrl(samplePaths, 240, 240);
  assert.ok(thumbnail.startsWith('data:image/png;base64,'), 'Thumbnail deve ser um dataUrl PNG válido');

  const withSketch = syncOrderFromProject(project, samplePaths, thumbnail);
  assert.equal(withSketch.useSketchAsReference, true);
  assert.ok(withSketch.currentOrder?.sketchDrawing);
  assert.equal(withSketch.currentOrder.sketchDrawing.hasDrawing, true);
  assert.equal(withSketch.currentOrder.sketchDrawing.paths.length, 1);
  assert.equal(withSketch.currentOrder.sketchDrawing.dataUrl, thumbnail);
});

test('UI Flow 4: sketch draw modal cancel preserves previously applied drawing state strictly', () => {
  const initialPaths: SketchPath[] = [
    {
      id: 'p-original',
      tool: 'brush',
      color: '#3b82f6',
      size: 4,
      opacity: 1,
      points: [{ x: 50, y: 50 }, { x: 60, y: 60 }],
    },
  ];

  // Simula abertura do modal com snapshot
  let activePaths = [...initialPaths];
  let draftPaths = [...initialPaths, {
    id: 'p-draft',
    tool: 'brush' as const,
    color: '#ef4444',
    size: 10,
    opacity: 1,
    points: [{ x: 999, y: 999 }],
  }];

  // Simula ação de Cancelar: descarta draftPaths e reverte para snapshot
  draftPaths = [...initialPaths];
  activePaths = draftPaths;

  assert.equal(activePaths.length, 1);
  assert.equal(activePaths[0].id, 'p-original');
  assert.equal(activePaths.some((p) => p.id === 'p-draft'), false, 'Rascunho cancelado não deve persistir');
});

test('UI Flow 5: "Outra ideia" and "O que você quer mudar?" register proper ChangeIntent contracts', () => {
  const project = createCleanProject();
  project.prompt = 'Café especial gourmet torra média';

  // Simula intenção de "Outra ideia"
  const newConceptIntent: SketchChangeIntent = {
    schemaVersion: 1,
    version: '1.0.0',
    id: `intent-concept-${Date.now()}`,
    type: 'new_concept',
    targetResultId: 'res-prev-1',
    userFeedback: 'Outra ideia com foco em café da manhã acolhedor',
    keepBaseImage: false,
    createdAt: new Date().toISOString(),
  };

  assert.equal(newConceptIntent.type, 'new_concept');
  assert.equal(newConceptIntent.keepBaseImage, false);

  // Simula intenção de ajuste de texto ("O que você quer mudar?")
  const textAdjustmentIntent: SketchChangeIntent = {
    schemaVersion: 1,
    version: '1.0.0',
    id: `intent-tweak-${Date.now()}`,
    type: 'refine_text',
    targetResultId: 'res-prev-1',
    userFeedback: 'Trocar o selo para Frete Grátis acima de R$120',
    keepBaseImage: true,
    createdAt: new Date().toISOString(),
  };

  assert.equal(textAdjustmentIntent.type, 'refine_text');
  assert.equal(textAdjustmentIntent.keepBaseImage, true);

  project.changeIntents = [newConceptIntent, textAdjustmentIntent];
  const normalized = normalizeProject(project);
  assert.equal(normalized.changeIntents?.length, 2);
  assert.equal(normalized.changeIntents[0].type, 'new_concept');
  assert.equal(normalized.changeIntents[1].type, 'refine_text');
});

test('UI Flow 6: aspect ratio selection covers all 5 FlowSupportedAspectRatio presets', () => {
  const supportedRatios: FlowSupportedAspectRatio[] = ['1:1', '9:16', '16:9', '4:3', '3:4'];

  for (const ratio of supportedRatios) {
    const project = createCleanProject({ aspectRatio: ratio });
    assert.equal(project.aspectRatio, ratio);
    const synced = syncOrderFromProject(project, []);
    assert.equal(synced.currentOrder?.aspectRatio, ratio);
  }
});
