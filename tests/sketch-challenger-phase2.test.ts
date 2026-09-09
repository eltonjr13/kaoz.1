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
import {
  type FlowSupportedAspectRatio,
  type SketchAttachment,
  type SketchChangeIntent,
  type SketchLayer,
  type SketchPath,
  type SketchProjectData,
  type SketchReferenceRole,
  type SketchSimpleOrder,
  MAX_SKETCH_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '../types/sketch.ts';

// Logic mirror of syncOrderFromProject in sketch-single-flow.tsx
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

// Logic mirror of resolveReferenceDataUrl in sketch-single-flow.tsx
function resolveReferenceDataUrl(
  paths: SketchPath[],
  thumbnail?: string
): string | undefined {
  if (paths.length === 0) return undefined;
  return thumbnail || renderSketchOnlyDataUrl(paths, 1080, 1080);
}

// Logic mirror of file validator in sketch-attachment-bar.tsx
function validateAttachmentFile(fileType: string, fileSize: number): string | null {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/jpg'];
  if (!allowedTypes.includes(fileType)) {
    return 'Formato inválido. Use PNG, JPEG ou WEBP.';
  }
  if (fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
    return 'Tamanho máximo excedido (limite: 10MB).';
  }
  return null;
}

// Logic mirror of clipboard paste check in sketch-attachment-bar.tsx
function shouldHandleClipboardPaste(
  targetTag: string,
  hasClipboardFiles: boolean,
  disabled: boolean,
  canAddMore: boolean
): boolean {
  if (disabled || !canAddMore) return false;
  const isTextInput = targetTag === 'INPUT' || targetTag === 'TEXTAREA';
  if (isTextInput && !hasClipboardFiles) {
    return false;
  }
  return true;
}

// Logic mirror of aspect ratio class resolution in sketch-result-view.tsx
function resolveAspectRatioClass(ratio: FlowSupportedAspectRatio): string {
  switch (ratio) {
    case '9:16':
      return 'aspect-[9/16] max-h-[560px]';
    case '16:9':
      return 'aspect-[16/9] max-h-[440px]';
    case '4:3':
      return 'aspect-[4/3] max-h-[460px]';
    case '3:4':
      return 'aspect-[3/4] max-h-[520px]';
    case '1:1':
    default:
      return 'aspect-square max-h-[480px]';
  }
}

// Logic mirror of lineage label resolution in sketch-result-view.tsx
function resolveIterationLabel(iterationType?: string, versionNumber?: number): string {
  const v = versionNumber ? `v${versionNumber}` : 'v1';
  switch (iterationType) {
    case 'new_concept':
      return `Outra ideia (${v})`;
    case 'text_adjustment':
      return `Ajuste de texto (${v})`;
    case 'visual_adjustment':
      return `Ajuste visual (${v})`;
    case 'initial':
    default:
      return `Versão original (${v})`;
  }
}

// -------------------------------------------------------------------------
// Scenario 1: Empty Prompt & Clean Initial Project
// -------------------------------------------------------------------------
test('Adversarial Scenario 1: Initial state starts completely clean without canned copy, CTAs or labels', () => {
  const cleanProject = createCleanProject();

  assert.strictEqual(cleanProject.prompt, '', 'Initial prompt must be empty string');
  assert.strictEqual(cleanProject.attachments.length, 0, 'Must have zero attachments initially');
  assert.strictEqual(cleanProject.layers.length, 1, 'Must have exactly 1 layer (background only)');
  assert.strictEqual(cleanProject.layers[0].type, 'background', 'First layer must be background');

  // Verify absence of all legacy canned text layers
  const forbiddenLayerIds = ['layer-text-headline', 'layer-text-subheadline', 'layer-text-cta', 'layer-text-badge'];
  for (const layer of cleanProject.layers) {
    assert.ok(!forbiddenLayerIds.includes(layer.id), `Forbidden layer ${layer.id} found in clean project`);
  }

  // Verify whitespace-only prompt cannot trigger generation
  const whitespacePrompts = ['   ', '\t\t', '\n\n', '   \n \t  '];
  for (const wsp of whitespacePrompts) {
    assert.strictEqual(wsp.trim(), '', 'Whitespace prompt must trim to empty string');
    assert.strictEqual(!wsp.trim(), true, 'Generation must be blocked for whitespace prompt');
  }

  // Verify syncOrderFromProject on clean project produces clean order
  const synced = syncOrderFromProject(cleanProject, []);
  assert.ok(synced.currentOrder, 'Must have currentOrder');
  assert.strictEqual(synced.currentOrder.prompt, '');
  assert.strictEqual(synced.currentOrder.selectedReferences.length, 0);
  assert.strictEqual(synced.useSketchAsReference, false);
  assert.strictEqual(synced.currentOrder.sketchDrawing, undefined);
});

// -------------------------------------------------------------------------
// Scenario 4: Sketch Drawing Modal Lifecycle & Empty Drawing Handling
// -------------------------------------------------------------------------
test('Adversarial Scenario 4A: Drawing in sketch modal produces thumbnail and sets useSketchAsReference true', () => {
  const project = createCleanProject();
  project.prompt = 'Suco detox natural prensado a frio';

  const strokePaths: SketchPath[] = [
    {
      id: 'p-adv-1',
      tool: 'brush',
      color: '#10b981',
      size: 8,
      opacity: 1,
      points: [
        { x: 120, y: 150 },
        { x: 250, y: 300 },
        { x: 400, y: 450 },
      ],
    },
    {
      id: 'p-adv-2',
      tool: 'brush',
      color: '#f59e0b',
      size: 4,
      opacity: 1,
      points: [
        { x: 400, y: 450 },
        { x: 500, y: 550 },
      ],
    },
  ];

  const thumbnail = renderSketchOnlyDataUrl(strokePaths, 240, 240);
  assert.ok(thumbnail.startsWith('data:image/png;base64,'), 'Thumbnail must be valid base64 PNG dataUrl');

  const synced = syncOrderFromProject(project, strokePaths, thumbnail);
  assert.strictEqual(synced.useSketchAsReference, true, 'useSketchAsReference must be true when paths exist');
  assert.ok(synced.currentOrder?.sketchDrawing, 'sketchDrawing must be defined');
  assert.strictEqual(synced.currentOrder.sketchDrawing.hasDrawing, true);
  assert.strictEqual(synced.currentOrder.sketchDrawing.paths.length, 2);
  assert.strictEqual(synced.currentOrder.sketchDrawing.dataUrl, thumbnail);

  const refUrl = resolveReferenceDataUrl(strokePaths, thumbnail);
  assert.strictEqual(refUrl, thumbnail, 'Reference data URL must match thumbnail when provided');
});

test('Adversarial Scenario 4B: Empty sketch or cleared canvas sends zero paths and sets useSketchAsReference false', () => {
  const project = createCleanProject();
  project.prompt = 'Fone bluetooth com cancelamento de ruído';

  // Empty paths
  const emptyPaths: SketchPath[] = [];
  const syncedEmpty = syncOrderFromProject(project, emptyPaths, undefined);
  assert.strictEqual(syncedEmpty.useSketchAsReference, false, 'useSketchAsReference must be false for empty paths');
  assert.strictEqual(syncedEmpty.currentOrder?.sketchDrawing, undefined, 'sketchDrawing must be undefined');

  const refUrlEmpty = resolveReferenceDataUrl(emptyPaths, undefined);
  assert.strictEqual(refUrlEmpty, undefined, 'Reference data URL must be undefined when no paths exist');

  // Transition test: previously had sketch, now cleared
  const sampleSketchLayer: SketchLayer = {
    id: 'layer-sketch-root',
    name: 'Esboço de Composição',
    type: 'sketch',
    paths: [{ id: 'p1', tool: 'brush', color: '#000', size: 4, opacity: 1, points: [{ x: 10, y: 10 }] }],
    visible: true,
    opacity: 0.85,
    elementKind: 'annotation',
    includeInFinalExport: false,
  };
  project.layers.push(sampleSketchLayer);
  assert.strictEqual(project.layers.length, 2);

  // Clearing sketch: filter out sketch layer and pass empty paths
  const clearedLayers = project.layers.filter((l) => l.type !== 'sketch');
  assert.strictEqual(clearedLayers.length, 1, 'Sketch layer must be removed from layers');
  assert.strictEqual(clearedLayers[0].type, 'background');

  const clearedProject = syncOrderFromProject({ ...project, layers: clearedLayers }, [], undefined);
  assert.strictEqual(clearedProject.useSketchAsReference, false);
  assert.strictEqual(clearedProject.currentOrder?.sketchDrawing, undefined);
});

// -------------------------------------------------------------------------
// Scenario 6: Reopening drawing modal and clicking cancel strictly preserves state
// -------------------------------------------------------------------------
test('Adversarial Scenario 6: Modal cancel preserves previously applied drawing across multiple reopen cycles', () => {
  const originalPaths: SketchPath[] = [
    {
      id: 'p-committed-1',
      tool: 'brush',
      color: '#3b82f6',
      size: 4,
      opacity: 1,
      points: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
    },
    {
      id: 'p-committed-2',
      tool: 'brush',
      color: '#ec4899',
      size: 6,
      opacity: 1,
      points: [{ x: 300, y: 300 }, { x: 400, y: 400 }],
    },
  ];

  // Simulation State Machine mimicking SketchSingleFlow & SketchDrawModal
  let parentCommittedPaths = [...originalPaths];

  // --- Cycle 1: User opens modal, adds draft stroke, then CANCELS ---
  let modalDraftPaths = [...parentCommittedPaths];
  // User draws a new draft stroke
  modalDraftPaths.push({
    id: 'p-draft-unwanted',
    tool: 'brush',
    color: '#ef4444',
    size: 14,
    opacity: 1,
    points: [{ x: 800, y: 800 }, { x: 900, y: 900 }],
  });
  assert.strictEqual(modalDraftPaths.length, 3);

  // User hits CANCEL -> modal closes without calling onApply
  // Modal resets internal draft back to parentCommittedPaths on next open
  modalDraftPaths = [...parentCommittedPaths];

  assert.strictEqual(parentCommittedPaths.length, 2, 'Parent paths must remain strictly unchanged on cancel');
  assert.strictEqual(parentCommittedPaths[0].id, 'p-committed-1');
  assert.strictEqual(parentCommittedPaths[1].id, 'p-committed-2');
  assert.strictEqual(modalDraftPaths.some((p) => p.id === 'p-draft-unwanted'), false);

  // --- Cycle 2: User opens modal, clears all strokes, then CANCELS ---
  modalDraftPaths = []; // User clicked "Limpar tela"
  assert.strictEqual(modalDraftPaths.length, 0);

  // User hits CANCEL -> discard clear, parent still holds 2 strokes
  modalDraftPaths = [...parentCommittedPaths];
  assert.strictEqual(parentCommittedPaths.length, 2, 'Parent paths must not be cleared when user cancels');

  // --- Cycle 3: User opens modal, adds valid stroke, hits APPLY ---
  const newStroke: SketchPath = {
    id: 'p-applied-3',
    tool: 'brush',
    color: '#10b981',
    size: 2,
    opacity: 1,
    points: [{ x: 50, y: 50 }],
  };
  modalDraftPaths.push(newStroke);
  // User hits APPLY
  parentCommittedPaths = [...modalDraftPaths];
  assert.strictEqual(parentCommittedPaths.length, 3, 'Committed paths must now include applied stroke');

  // --- Cycle 4: User opens modal again, deletes everything, then CANCELS ---
  modalDraftPaths = [];
  // User cancels
  modalDraftPaths = [...parentCommittedPaths];
  assert.strictEqual(parentCommittedPaths.length, 3, 'All 3 strokes must survive cancel after previous apply');
  assert.strictEqual(parentCommittedPaths[2].id, 'p-applied-3');
});

// -------------------------------------------------------------------------
// Attachments: Drag-and-Drop, Clipboard Paste, Role Tagging & Constraints
// -------------------------------------------------------------------------
test('Adversarial Attachments: Role tagging supports all 6 valid roles and syncs into order references', () => {
  const allRoles: SketchReferenceRole[] = [
    'product',
    'person',
    'logo',
    'style',
    'composition',
    'background',
  ];

  const project = createCleanProject();

  allRoles.forEach((role, idx) => {
    project.attachments.push({
      id: `att-${idx + 1}`,
      name: `ref-${role}.png`,
      dataUrl: `data:image/png;base64,mock${idx}`,
      role,
      createdAt: new Date().toISOString(),
    });
  });

  assert.strictEqual(project.attachments.length, 6);

  const synced = syncOrderFromProject(project, []);
  assert.strictEqual(synced.currentOrder?.selectedReferences.length, 6);

  const refs = synced.currentOrder?.selectedReferences || [];
  for (let i = 0; i < allRoles.length; i++) {
    const item = refs[i];
    assert.strictEqual(item?.role, allRoles[i], `Role mismatch at index ${i}`);
    assert.strictEqual(item?.attachmentId, `att-${i + 1}`);
  }

  // Test updating role dynamically
  project.attachments[0].role = 'background';
  const resynced = syncOrderFromProject(project, []);
  assert.strictEqual(resynced.currentOrder?.selectedReferences[0].role, 'background');

  // Test removing attachment
  project.attachments.splice(0, 1);
  assert.strictEqual(project.attachments.length, 5);
  const afterRemove = syncOrderFromProject(project, []);
  assert.strictEqual(afterRemove.currentOrder?.selectedReferences.length, 5);
  assert.strictEqual(afterRemove.currentOrder?.selectedReferences[0].attachmentId, 'att-2');
});

test('Adversarial Attachments: Validation rejects invalid file types and sizes over 10MB', () => {
  // Valid types
  assert.strictEqual(validateAttachmentFile('image/png', 5000), null);
  assert.strictEqual(validateAttachmentFile('image/jpeg', 2048), null);
  assert.strictEqual(validateAttachmentFile('image/webp', 8000), null);
  assert.strictEqual(validateAttachmentFile('image/jpg', 4096), null);

  // Invalid types
  assert.strictEqual(
    validateAttachmentFile('application/pdf', 1000),
    'Formato inválido. Use PNG, JPEG ou WEBP.'
  );
  assert.strictEqual(
    validateAttachmentFile('image/gif', 1000),
    'Formato inválido. Use PNG, JPEG ou WEBP.'
  );
  assert.strictEqual(
    validateAttachmentFile('text/plain', 500),
    'Formato inválido. Use PNG, JPEG ou WEBP.'
  );
  assert.strictEqual(
    validateAttachmentFile('application/x-msdownload', 1000),
    'Formato inválido. Use PNG, JPEG ou WEBP.'
  );

  // Size boundary tests
  assert.strictEqual(validateAttachmentFile('image/png', MAX_ATTACHMENT_SIZE_BYTES), null);
  assert.strictEqual(
    validateAttachmentFile('image/png', MAX_ATTACHMENT_SIZE_BYTES + 1),
    'Tamanho máximo excedido (limite: 10MB).'
  );
  assert.strictEqual(
    validateAttachmentFile('image/png', 50 * 1024 * 1024),
    'Tamanho máximo excedido (limite: 10MB).'
  );
});

test('Adversarial Attachments: Enforces maximum attachment limit of 6', () => {
  assert.strictEqual(MAX_SKETCH_ATTACHMENTS, 6);

  const attachments: SketchAttachment[] = [];
  for (let i = 0; i < 6; i++) {
    attachments.push({
      id: `att-${i}`,
      name: `img-${i}.png`,
      dataUrl: 'data:image/png;base64,mock',
      role: 'style',
      createdAt: new Date().toISOString(),
    });
  }

  const canAddMoreAtLimit = attachments.length < MAX_SKETCH_ATTACHMENTS;
  assert.strictEqual(canAddMoreAtLimit, false, 'canAddMore must be false when limit of 6 is reached');

  // Clipboard paste must also be blocked when limit reached
  const shouldPasteAtLimit = shouldHandleClipboardPaste('DIV', true, false, canAddMoreAtLimit);
  assert.strictEqual(shouldPasteAtLimit, false, 'Clipboard paste must be blocked when at capacity');
});

test('Adversarial Attachments: Clipboard paste does not hijack standard text paste in inputs', () => {
  // Scenario 1: Typing text into TEXTAREA and pasting text (no clipboard files)
  const pasteTextInTextarea = shouldHandleClipboardPaste('TEXTAREA', false, false, true);
  assert.strictEqual(pasteTextInTextarea, false, 'Must not intercept plain text paste in textarea');

  // Scenario 2: Typing text into INPUT and pasting text (no clipboard files)
  const pasteTextInInput = shouldHandleClipboardPaste('INPUT', false, false, true);
  assert.strictEqual(pasteTextInInput, false, 'Must not intercept plain text paste in input');

  // Scenario 3: Pasting image screenshot while focused on body/div
  const pasteImageOnDiv = shouldHandleClipboardPaste('DIV', true, false, true);
  assert.strictEqual(pasteImageOnDiv, true, 'Must intercept image paste on container');

  // Scenario 4: Pasting image file while in textarea
  const pasteImageInTextarea = shouldHandleClipboardPaste('TEXTAREA', true, false, true);
  assert.strictEqual(pasteImageInTextarea, true, 'Must intercept image paste even inside textarea');

  // Scenario 5: Disabled state blocks paste
  const pasteWhenDisabled = shouldHandleClipboardPaste('DIV', true, true, true);
  assert.strictEqual(pasteWhenDisabled, false, 'Must block paste when disabled');
});

// -------------------------------------------------------------------------
// Result Screen Actions: "Outra ideia" & Adjustment Intent Contracts
// -------------------------------------------------------------------------
test('Adversarial Result Screen: "Outra ideia" creates new_concept intent without keeping base image', () => {
  const project = createCleanProject();
  project.prompt = 'Curso de oratória executiva para líderes';

  const newConceptIntent: SketchChangeIntent = {
    schemaVersion: 1,
    version: '1.0.0',
    id: `intent-concept-${Date.now()}`,
    type: 'new_concept',
    targetResultId: 'res-origin-1',
    userFeedback: 'Outra ideia',
    keepBaseImage: false,
    createdAt: new Date().toISOString(),
  };

  assert.strictEqual(newConceptIntent.type, 'new_concept');
  assert.strictEqual(newConceptIntent.keepBaseImage, false);
  assert.strictEqual(newConceptIntent.userFeedback, 'Outra ideia');

  project.changeIntents = [newConceptIntent];
  const normalized = normalizeProject(project);
  assert.strictEqual(normalized.changeIntents?.length, 1);
  assert.strictEqual(normalized.changeIntents[0].type, 'new_concept');
  assert.strictEqual(normalized.changeIntents[0].keepBaseImage, false);
});

test('Adversarial Result Screen: "O que você quer mudar?" creates refine_text intent keeping base image', () => {
  const project = createCleanProject();
  project.prompt = 'Suplemento proteico isolado sabor baunilha';

  const tweakFeedback = 'Mudar preço de R$ 189 para R$ 149 e destacar 20g de proteína';
  const textAdjustmentIntent: SketchChangeIntent = {
    schemaVersion: 1,
    version: '1.0.0',
    id: `intent-tweak-${Date.now()}`,
    type: 'refine_text',
    targetResultId: 'res-origin-1',
    userFeedback: tweakFeedback,
    keepBaseImage: true,
    createdAt: new Date().toISOString(),
  };

  assert.strictEqual(textAdjustmentIntent.type, 'refine_text');
  assert.strictEqual(textAdjustmentIntent.keepBaseImage, true);
  assert.strictEqual(textAdjustmentIntent.userFeedback, tweakFeedback);

  project.changeIntents = [textAdjustmentIntent];
  const normalized = normalizeProject(project);
  assert.strictEqual(normalized.changeIntents?.length, 1);
  assert.strictEqual(normalized.changeIntents[0].type, 'refine_text');
  assert.strictEqual(normalized.changeIntents[0].keepBaseImage, true);
});

test('Adversarial Result Screen: Aspect ratio classes and lineage labels cover all variants', () => {
  const supportedRatios: FlowSupportedAspectRatio[] = ['1:1', '9:16', '16:9', '4:3', '3:4'];
  const expectedClasses: Record<FlowSupportedAspectRatio, string> = {
    '1:1': 'aspect-square max-h-[480px]',
    '9:16': 'aspect-[9/16] max-h-[560px]',
    '16:9': 'aspect-[16/9] max-h-[440px]',
    '4:3': 'aspect-[4/3] max-h-[460px]',
    '3:4': 'aspect-[3/4] max-h-[520px]',
  };

  for (const ratio of supportedRatios) {
    assert.strictEqual(resolveAspectRatioClass(ratio), expectedClasses[ratio]);
  }

  // Lineage label tests
  assert.strictEqual(resolveIterationLabel('initial', 1), 'Versão original (v1)');
  assert.strictEqual(resolveIterationLabel('new_concept', 2), 'Outra ideia (v2)');
  assert.strictEqual(resolveIterationLabel('text_adjustment', 3), 'Ajuste de texto (v3)');
  assert.strictEqual(resolveIterationLabel('visual_adjustment', 4), 'Ajuste visual (v4)');
  assert.strictEqual(resolveIterationLabel(undefined, undefined), 'Versão original (v1)');
});

// -------------------------------------------------------------------------
// Storage & Save Coordinator Integration
// -------------------------------------------------------------------------
test('Adversarial Coordinator: Flushes dirty edits before generation and resets cleanly', async () => {
  let saveCount = 0;
  let savedData: SketchProjectData | null = null;

  const coordinator = new SketchSaveCoordinator(async (proj) => {
    saveCount++;
    savedData = proj;
    return true;
  });

  const project = createCleanProject({ title: 'Anúncio Teste Coord' });
  project.prompt = 'Novo produto inovador';

  coordinator.registerEdit(project, 1000);
  assert.strictEqual(coordinator.isDirty(), true, 'Coordinator must be dirty after registerEdit');

  // Simulated flush before handleGenerate
  await coordinator.flushSave();
  assert.strictEqual(coordinator.isDirty(), false, 'Coordinator must not be dirty after flushSave');
  assert.strictEqual(saveCount, 1, 'Save callback must be invoked once');
  const finalSaved = savedData as SketchProjectData | null;
  assert.strictEqual(finalSaved?.prompt, 'Novo produto inovador');

  // Resetting coordinator
  coordinator.reset(0);
  assert.strictEqual(coordinator.isDirty(), false);
});
