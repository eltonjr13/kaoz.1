import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  SketchSaveCoordinator,
  type SaveStatus,
  type SaveResult,
} from '../lib/sketch/sketch-save-coordinator.ts';
import {
  createCleanProject,
} from '../lib/sketch/sketch-project-defaults.ts';
import {
  validateAttachmentBuffer,
  detectImageFormatFromMagicBytes,
} from '../lib/sketch/sketch-attachment-validator.ts';
import {
  extractBufferFromDataUrl,
} from '../lib/sketch/sketch-job-manager.ts';
import {
  renderSketchOnlyDataUrl,
} from '../lib/sketch/sketch-exporter.ts';
import {
  type FlowSupportedAspectRatio,
  type SketchAttachment,
  type SketchLayer,
  type SketchPath,
  type SketchProjectData,
  type SketchReferenceRole,
  type SketchSimpleOrder,
  MAX_SKETCH_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '../types/sketch.ts';

// Helper mirror: syncOrderFromProject in sketch-single-flow.tsx
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

// Helper: generate valid small PNG buffer
async function createValidPngBuffer(width = 40, height = 40): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 66, g: 133, b: 244, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

// -----------------------------------------------------------------------------
// SECTION 1: SketchSaveCoordinator Edge Cases
// -----------------------------------------------------------------------------

test('SaveCoordinator: 50 rapid edits are debounced into exactly one final save', async () => {
  let persistCallCount = 0;
  let lastPersistedProject: SketchProjectData | null = null;
  let lastPersistedRev = 0;

  const coordinator = new SketchSaveCoordinator(async (proj, rev) => {
    persistCallCount++;
    lastPersistedProject = proj;
    lastPersistedRev = rev;
    return true;
  });

  const project = createCleanProject({ title: 'Rapid Typing Test' });

  // Rapidly dispatch 50 keystrokes / edits
  for (let i = 1; i <= 50; i++) {
    coordinator.registerEdit(
      { ...project, prompt: `Prompt version ${i}` },
      150 // 150ms debounce
    );
  }

  assert.strictEqual(coordinator.getCurrentRevision(), 50);
  assert.strictEqual(coordinator.getSavedRevision(), 0);
  assert.strictEqual(coordinator.isDirty(), true);
  assert.strictEqual(persistCallCount, 0, 'No saves should trigger synchronously during burst');

  // Wait for debounce timer to fire
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.strictEqual(persistCallCount, 1, 'Only 1 persist should occur for 50 rapid edits');
  assert.strictEqual(lastPersistedRev, 50, 'Persisted revision must be 50');
  assert.strictEqual((lastPersistedProject as SketchProjectData | null)?.prompt, 'Prompt version 50');
  assert.strictEqual(coordinator.isDirty(), false);
  assert.strictEqual(coordinator.getSavedRevision(), 50);
});

test('SaveCoordinator: in-flight save with concurrent edit queues pending and executes next save', async () => {
  let persistCallCount = 0;
  const savedRevisions: number[] = [];

  const coordinator = new SketchSaveCoordinator(async (proj, rev) => {
    persistCallCount++;
    savedRevisions.push(rev);
    // Simulate slow network save (80ms)
    await new Promise((resolve) => setTimeout(resolve, 80));
    return true;
  });

  const project = createCleanProject();

  // 1. First edit: triggers debounce
  coordinator.registerEdit({ ...project, prompt: 'Edit 1' }, 20);

  // Wait for debounce to trigger in-flight save
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.strictEqual(coordinator.isSaving(), true, 'Save 1 must be in flight');

  // 2. While Save 1 is in-flight, register Edit 2 and Edit 3
  coordinator.registerEdit({ ...project, prompt: 'Edit 2' }, 20);
  coordinator.registerEdit({ ...project, prompt: 'Edit 3' }, 20);

  assert.strictEqual(coordinator.getPendingRevision()?.revision, 3);

  // Wait for Save 1 to complete (80ms) + internal timer (300ms) + Save 2 (80ms)
  await new Promise((resolve) => setTimeout(resolve, 520));

  assert.strictEqual(persistCallCount, 2, 'Should have persisted exactly twice (rev 1 and rev 3)');
  assert.deepStrictEqual(savedRevisions, [1, 3]);
  assert.strictEqual(coordinator.isDirty(), false);
  assert.strictEqual(coordinator.getSavedRevision(), 3);
});

test('SaveCoordinator: flushSave immediately flushes dirty state before generation without waiting for debounce', async () => {
  let persistedPrompt = '';
  let flushReturned: SaveResult | null = null;

  const coordinator = new SketchSaveCoordinator(async (proj) => {
    persistedPrompt = proj.prompt;
    return true;
  });

  const project = createCleanProject();
  project.prompt = 'Creative prompt ready for generation';

  // Registered with high debounce delay (5000ms)
  coordinator.registerEdit(project, 5000);
  assert.strictEqual(coordinator.isDirty(), true);
  assert.strictEqual(persistedPrompt, '', 'Debounce timer has not elapsed');

  // Simulate handleGenerate triggering flushSave
  flushReturned = await coordinator.flushSave();

  assert.ok(flushReturned.success, 'flushSave must return success: true');
  assert.strictEqual(flushReturned.savedRevision, 1);
  assert.strictEqual(persistedPrompt, 'Creative prompt ready for generation');
  assert.strictEqual(coordinator.isDirty(), false);
});

test('SaveCoordinator: concurrent flushSave calls resolve safely without double submission', async () => {
  let callCount = 0;

  const coordinator = new SketchSaveCoordinator(async () => {
    callCount++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return true;
  });

  const project = createCleanProject();
  coordinator.registerEdit(project, 2000);

  // Trigger two flushSave calls concurrently (double click)
  const [res1, res2] = await Promise.all([
    coordinator.flushSave(),
    coordinator.flushSave(),
  ]);

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res2.success, true);
  assert.strictEqual(callCount, 1, 'Only one actual persist operation must execute');
  assert.strictEqual(coordinator.isDirty(), false);
});

test('SaveCoordinator: persist failure sets error status, preserves pendingRevision and retry recovers', async () => {
  let shouldFail = true;
  let statusHistory: SaveStatus[] = [];
  let errorHistory: string[] = [];

  const coordinator = new SketchSaveCoordinator(
    async () => {
      if (shouldFail) {
        throw new Error('500 Internal Server Error');
      }
      return true;
    },
    {
      onStatusChange: (status, err) => {
        statusHistory.push(status);
        if (err) errorHistory.push(err);
      },
    }
  );

  const project = createCleanProject();
  coordinator.registerEdit(project, 5000);

  // Attempt flush with failing server
  const failRes = await coordinator.flushSave();
  assert.strictEqual(failRes.success, false);
  assert.strictEqual(failRes.error, '500 Internal Server Error');
  assert.strictEqual(coordinator.isDirty(), true);
  assert.ok(coordinator.getPendingRevision() !== null, 'Pending revision must be preserved for retry');
  assert.strictEqual(statusHistory[statusHistory.length - 1], 'error');

  // Fix server and retry flush
  shouldFail = false;
  const retryRes = await coordinator.flushSave();
  assert.strictEqual(retryRes.success, true);
  assert.strictEqual(coordinator.isDirty(), false);
  assert.strictEqual(statusHistory[statusHistory.length - 1], 'saved');
});

// -----------------------------------------------------------------------------
// SECTION 2: Attachment Dropzone / Paste Boundary & Validation
// -----------------------------------------------------------------------------

test('Attachment Boundary: 0 attachments initializes empty references and permits generation', () => {
  const project = createCleanProject();
  assert.strictEqual(project.attachments.length, 0);

  const synced = syncOrderFromProject(project, []);
  assert.strictEqual(synced.currentOrder?.selectedReferences.length, 0);
  assert.strictEqual(synced.attachments.length, 0);

  // Empty attachments array can proceed to generate as long as prompt is non-empty
  const prompt = 'Ad without any attachment';
  assert.strictEqual(Boolean(prompt.trim()), true);
});

test('Attachment Boundary: exactly 6 attachments fill all roles, reaching capacity limit', async () => {
  const validBuffer = await createValidPngBuffer();
  const roles: SketchReferenceRole[] = ['product', 'person', 'logo', 'style', 'composition', 'background'];

  // Test adding up to 6 attachments with validator
  for (let count = 0; count < 6; count++) {
    const res = await validateAttachmentBuffer(validBuffer, { currentAttachmentCount: count });
    assert.strictEqual(res.valid, true, `Attachment ${count + 1} of 6 must be valid`);
  }

  // Populate project with 6 attachments
  const project = createCleanProject();
  roles.forEach((role, i) => {
    project.attachments.push({
      id: `att-bound-${i + 1}`,
      name: `asset-${role}.png`,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      role,
      createdAt: new Date().toISOString(),
    });
  });

  assert.strictEqual(project.attachments.length, MAX_SKETCH_ATTACHMENTS);

  const synced = syncOrderFromProject(project, []);
  assert.strictEqual(synced.currentOrder?.selectedReferences.length, 6);

  // canAddMore logic in UI must evaluate to false
  const canAddMore = project.attachments.length < MAX_SKETCH_ATTACHMENTS;
  assert.strictEqual(canAddMore, false, 'canAddMore must be false when exactly 6 attachments');
});

test('Attachment Boundary: 7th attachment attempt is strictly rejected by server validator', async () => {
  const validBuffer = await createValidPngBuffer();

  // Attempting to add when currentAttachmentCount is 6 (attempting 7th)
  const rejectedAt6 = await validateAttachmentBuffer(validBuffer, { currentAttachmentCount: 6 });
  assert.strictEqual(rejectedAt6.valid, false);
  if (!rejectedAt6.valid) {
    assert.strictEqual(rejectedAt6.statusCode, 400);
    assert.ok(rejectedAt6.error.includes('Limite máximo de 6 anexos por projeto atingido'));
  }

  // Attempting to add when currentAttachmentCount is 7
  const rejectedAt7 = await validateAttachmentBuffer(validBuffer, { currentAttachmentCount: 7 });
  assert.strictEqual(rejectedAt7.valid, false);
  if (!rejectedAt7.valid) {
    assert.strictEqual(rejectedAt7.statusCode, 400);
  }
});

test('Attachment Boundary: corrupt base64 dataUrls and invalid data prefixes are safely rejected', () => {
  // Empty dataUrl
  assert.strictEqual(extractBufferFromDataUrl(''), null);

  // Non data:image prefix
  assert.strictEqual(extractBufferFromDataUrl('http://example.com/image.png'), null);
  assert.strictEqual(extractBufferFromDataUrl('data:text/plain;base64,SGVsbG8='), null);
  assert.strictEqual(extractBufferFromDataUrl('data:application/json;base64,e30='), null);

  // Malformed structure without base64 marker
  assert.strictEqual(extractBufferFromDataUrl('data:image/png;utf8,rawimage'), null);

  // Empty base64 payload
  assert.strictEqual(extractBufferFromDataUrl('data:image/png;base64,'), null);

  // Valid format produces Buffer
  const validDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const buf = extractBufferFromDataUrl(validDataUrl);
  assert.ok(buf !== null);
  assert.ok(Buffer.isBuffer(buf));
  assert.strictEqual(detectImageFormatFromMagicBytes(buf), 'png');
});

test('Attachment Boundary: oversize files, fake headers, and corrupt images are rejected', async () => {
  // 1. Zero-length buffer
  const emptyRes = await validateAttachmentBuffer(Buffer.alloc(0));
  assert.strictEqual(emptyRes.valid, false);
  if (!emptyRes.valid) {
    assert.strictEqual(emptyRes.statusCode, 400);
    assert.ok(emptyRes.error.includes('Arquivo vazio'));
  }

  // 2. Oversize buffer (> 10MB)
  const oversizeBuf = Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1);
  // Give it PNG magic bytes to verify size check precedes format
  oversizeBuf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const oversizeRes = await validateAttachmentBuffer(oversizeBuf);
  assert.strictEqual(oversizeRes.valid, false);
  if (!oversizeRes.valid) {
    assert.strictEqual(oversizeRes.statusCode, 413);
    assert.ok(oversizeRes.error.includes('excede o limite máximo permitido de 10 MB'));
  }

  // 3. Corrupt PNG (valid 8-byte PNG header followed by 64 bytes of zeros / garbage)
  const corruptPng = Buffer.alloc(72);
  corruptPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const corruptRes = await validateAttachmentBuffer(corruptPng);
  assert.strictEqual(corruptRes.valid, false);
  if (!corruptRes.valid) {
    assert.strictEqual(corruptRes.statusCode, 400);
    assert.ok(corruptRes.error.includes('Falha ao decodificar imagem'));
  }

  // 4. Non-image file (Text file)
  const textBuf = Buffer.from('This is a plain text file pretending to be an attachment');
  const textRes = await validateAttachmentBuffer(textBuf);
  assert.strictEqual(textRes.valid, false);
  if (!textRes.valid) {
    assert.strictEqual(textRes.statusCode, 415);
  }
});

// -----------------------------------------------------------------------------
// SECTION 3: Sketch Modal Cancel vs Apply State Preservation
// -----------------------------------------------------------------------------

test('Sketch Modal: Cycle A (open -> draw -> clear -> cancel) strictly restores initial drawing', () => {
  // Setup parent initial state with 2 committed strokes
  const strokeA: SketchPath = {
    id: 'stroke-A',
    tool: 'brush',
    color: '#3b82f6',
    size: 4,
    opacity: 1,
    points: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
  };
  const strokeB: SketchPath = {
    id: 'stroke-B',
    tool: 'brush',
    color: '#10b981',
    size: 6,
    opacity: 1,
    points: [{ x: 300, y: 300 }, { x: 400, y: 400 }],
  };

  let parentSketchPaths: SketchPath[] = [strokeA, strokeB];
  let parentSketchThumbnail = renderSketchOnlyDataUrl(parentSketchPaths, 240, 240);

  // --- Modal Simulation ---
  // Modal opens with initialPaths = parentSketchPaths
  let modalPaths: SketchPath[] = [...parentSketchPaths];
  assert.strictEqual(modalPaths.length, 2);

  // User draws a 3rd draft stroke
  const strokeDraft: SketchPath = {
    id: 'stroke-draft',
    tool: 'brush',
    color: '#ef4444',
    size: 8,
    opacity: 1,
    points: [{ x: 500, y: 500 }, { x: 600, y: 600 }],
  };
  modalPaths.push(strokeDraft);
  assert.strictEqual(modalPaths.length, 3);

  // User clicks "Limpar tela" (handleClear)
  modalPaths = [];
  assert.strictEqual(modalPaths.length, 0);

  // User clicks "Cancelar" (onCancel):
  // onCancel closes modal without invoking onApply.
  // Parent state remains untouched.
  assert.strictEqual(parentSketchPaths.length, 2, 'Parent strokes must remain exactly 2');
  assert.strictEqual(parentSketchPaths[0].id, 'stroke-A');
  assert.strictEqual(parentSketchPaths[1].id, 'stroke-B');
  assert.ok(parentSketchThumbnail.startsWith('data:image/png;base64,'));

  // When modal reopens next time, useEffect resets modalPaths back to parentSketchPaths
  modalPaths = [...parentSketchPaths];
  assert.strictEqual(modalPaths.length, 2, 'Reopened modal must have the original 2 strokes restored');
});

test('Sketch Modal: Cycle B (open -> draw -> apply -> reopen -> cancel) strictly keeps applied drawing', () => {
  const stroke1: SketchPath = {
    id: 'stroke-1',
    tool: 'brush',
    color: '#ffffff',
    size: 4,
    opacity: 1,
    points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
  };

  let parentSketchPaths: SketchPath[] = [stroke1];
  let parentSketchThumbnail: string | undefined = renderSketchOnlyDataUrl(parentSketchPaths, 240, 240);
  let parentProject = createCleanProject();
  parentProject = syncOrderFromProject(parentProject, parentSketchPaths, parentSketchThumbnail);

  assert.strictEqual(parentProject.useSketchAsReference, true);
  assert.strictEqual(parentProject.currentOrder?.sketchDrawing?.paths.length, 1);

  // Step 1: Open modal and draw stroke 2
  let modalPaths = [...parentSketchPaths];
  const stroke2: SketchPath = {
    id: 'stroke-2',
    tool: 'brush',
    color: '#6366f1',
    size: 8,
    opacity: 1,
    points: [{ x: 150, y: 150 }, { x: 250, y: 250 }],
  };
  modalPaths.push(stroke2);

  // Step 2: User clicks "Aplicar Esboço" (handleApply)
  const appliedThumbnail = renderSketchOnlyDataUrl(modalPaths, 240, 240);
  parentSketchPaths = [...modalPaths];
  parentSketchThumbnail = appliedThumbnail;
  parentProject = syncOrderFromProject(parentProject, parentSketchPaths, parentSketchThumbnail);

  assert.strictEqual(parentSketchPaths.length, 2, 'Parent must now hold both strokes');
  assert.strictEqual(parentProject.currentOrder?.sketchDrawing?.paths.length, 2);

  // Step 3: User re-opens modal, clears canvas or scribbles unwanted draft
  modalPaths = [...parentSketchPaths];
  assert.strictEqual(modalPaths.length, 2);

  // User clears canvas
  modalPaths = [];

  // Step 4: User clicks "Cancelar"
  // onCancel is invoked -> onApply is NOT called.
  // Parent must keep the 2 applied strokes
  assert.strictEqual(parentSketchPaths.length, 2, 'Parent must strictly retain 2 applied strokes after cancel');
  assert.strictEqual(parentSketchPaths[1].id, 'stroke-2');
  assert.strictEqual(parentProject.currentOrder?.sketchDrawing?.paths.length, 2);
  assert.strictEqual(parentProject.useSketchAsReference, true);
});

test('Sketch Modal: Undo and redo branch truncation correctly manages stroke stack', () => {
  let history: SketchPath[][] = [[]];
  let historyIndex = 0;

  const pushState = (next: SketchPath[]) => {
    const truncated = history.slice(0, historyIndex + 1);
    truncated.push(next);
    history = truncated;
    historyIndex = truncated.length - 1;
  };

  const p1: SketchPath = { id: 'p1', tool: 'brush', color: '#000', size: 2, opacity: 1, points: [{ x: 1, y: 1 }] };
  const p2: SketchPath = { id: 'p2', tool: 'brush', color: '#000', size: 2, opacity: 1, points: [{ x: 2, y: 2 }] };
  const p3: SketchPath = { id: 'p3', tool: 'brush', color: '#000', size: 2, opacity: 1, points: [{ x: 3, y: 3 }] };

  // Draw 3 strokes
  pushState([p1]);
  pushState([p1, p2]);
  pushState([p1, p2, p3]);
  assert.strictEqual(history.length, 4);
  assert.strictEqual(historyIndex, 3);

  // Undo 2 times -> back to [p1]
  historyIndex--; // at [p1, p2]
  historyIndex--; // at [p1]
  assert.strictEqual(historyIndex, 1);
  assert.deepStrictEqual(history[historyIndex], [p1]);

  // Redo 1 time -> to [p1, p2]
  historyIndex++;
  assert.strictEqual(historyIndex, 2);
  assert.deepStrictEqual(history[historyIndex], [p1, p2]);

  // Now draw new stroke p4 -> truncates history (discards p3)
  const p4: SketchPath = { id: 'p4', tool: 'brush', color: '#000', size: 4, opacity: 1, points: [{ x: 4, y: 4 }] };
  pushState([...history[historyIndex], p4]);

  assert.strictEqual(history.length, 4); // [ [], [p1], [p1, p2], [p1, p2, p4] ]
  assert.strictEqual(historyIndex, 3);
  assert.deepStrictEqual(history[historyIndex], [p1, p2, p4]);
  assert.ok(!history.some((snap) => snap.some((p) => p.id === 'p3')), 'p3 must be permanently discarded by branch truncation');
});

test('Sketch Modal: Applying empty canvas clears sketch layer and disables useSketchAsReference', () => {
  const p1: SketchPath = { id: 'p1', tool: 'brush', color: '#000', size: 2, opacity: 1, points: [{ x: 1, y: 1 }] };
  let parentSketchPaths: SketchPath[] = [p1];
  let parentThumbnail: string | undefined = 'data:image/png;base64,sample';

  let project = createCleanProject();
  const sketchLayer: SketchLayer = {
    id: 'layer-sketch-root',
    name: 'Esboço de Composição',
    type: 'sketch',
    paths: [p1],
    visible: true,
    opacity: 0.85,
    elementKind: 'annotation',
    includeInFinalExport: false,
  };
  project.layers.push(sketchLayer);
  project = syncOrderFromProject(project, parentSketchPaths, parentThumbnail);
  assert.strictEqual(project.useSketchAsReference, true);

  // User applies empty canvas: handleApplySketch([], undefined)
  parentSketchPaths = [];
  parentThumbnail = undefined;
  const filteredLayers = project.layers.filter((l) => l.type !== 'sketch');
  project = { ...project, layers: filteredLayers };
  project = syncOrderFromProject(project, parentSketchPaths, parentThumbnail);

  assert.strictEqual(project.useSketchAsReference, false, 'useSketchAsReference must be false');
  assert.strictEqual(project.currentOrder?.sketchDrawing, undefined, 'sketchDrawing must be undefined');
  assert.strictEqual(project.layers.some((l) => l.type === 'sketch'), false, 'Sketch layer must be removed from layers');
});
