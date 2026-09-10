import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimpleOrder,
  createChangeIntent,
  classifyChangeIntent,
  executePlanningPhase,
  applyResultToProject,
  canReuseBaseImage,
  validateReferencesPreserved,
  buildResultLineage,
} from '../lib/sketch/sketch-pipeline-integrator.ts';
import type {
  SketchProjectData,
  SketchCreativeResult,
  FinalAssetResource,
} from '../types/sketch.ts';
import { createCleanProject } from '../lib/sketch/sketch-project-defaults.ts';

function makeFinalAsset(): FinalAssetResource {
  return {
    imageUrl: '/api/sketch/assets/gen-test.png',
    filePath: '/tmp/gen-test.png',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    fileSizeBytes: 150000,
    mimeType: 'image/png',
    format: 'png',
  };
}

// ---------------------------------------------------------------------------
// 1. SimpleOrder creation
// ---------------------------------------------------------------------------
describe('createSimpleOrder', () => {
  it('cria pedido com prompt e aspect ratio padrão', () => {
    const order = createSimpleOrder({ prompt: 'Tênis Nike Air Max' });
    assert.ok(order.id.startsWith('order-'));
    assert.strictEqual(order.prompt, 'Tênis Nike Air Max');
    assert.strictEqual(order.aspectRatio, '1:1');
    assert.strictEqual(order.selectedReferences.length, 0);
    assert.strictEqual(order.sketchDrawing, undefined);
  });

  it('cria pedido com referências e sketch', () => {
    const order = createSimpleOrder({
      prompt: 'Banner de verão',
      aspectRatio: '16:9',
      attachmentIds: ['att-1', 'att-2'],
      sketchDataUrl: 'data:image/png;base64,ABC',
    });
    assert.strictEqual(order.aspectRatio, '16:9');
    assert.strictEqual(order.selectedReferences.length, 2);
    assert.ok(order.sketchDrawing?.hasDrawing);
  });

  it('prompt sozinho funciona sem anexos ou sketch', () => {
    const order = createSimpleOrder({ prompt: 'Apenas um texto simples' });
    assert.strictEqual(order.selectedReferences.length, 0);
    assert.strictEqual(order.sketchDrawing, undefined);
  });
});

// ---------------------------------------------------------------------------
// 2. ChangeIntent classification
// ---------------------------------------------------------------------------
describe('classifyChangeIntent', () => {
  it('classifica ajuste de texto', () => {
    assert.strictEqual(classifyChangeIntent('Mude o título para algo mais curto'), 'refine_text');
    assert.strictEqual(classifyChangeIntent('Ajuste a frase do CTA'), 'refine_text');
  });

  it('classifica ajuste visual', () => {
    assert.strictEqual(classifyChangeIntent('Mude a cor de fundo'), 'refine_visual');
    assert.strictEqual(classifyChangeIntent('Ajuste a iluminação'), 'refine_visual');
  });

  it('classifica nova ideia', () => {
    assert.strictEqual(classifyChangeIntent('Quero outra ideia'), 'new_concept');
    assert.strictEqual(classifyChangeIntent('Algo completamente diferente'), 'new_concept');
  });

  it('cria intent com keepBaseImage para refine_text', () => {
    const intent = createChangeIntent('refine_text', 'result-1', 'Mude o título');
    assert.strictEqual(intent.keepBaseImage, true);
    assert.strictEqual(intent.type, 'refine_text');
  });

  it('cria intent sem keepBaseImage para new_concept', () => {
    const intent = createChangeIntent('new_concept', 'result-1', 'Outra ideia');
    assert.strictEqual(intent.keepBaseImage, false);
  });
});

// ---------------------------------------------------------------------------
// 3. Pipeline execution — planning phase
// ---------------------------------------------------------------------------
describe('executePlanningPhase', () => {
  it('prompt sozinho gera plano criativo válido', async () => {
    const order = createSimpleOrder({ prompt: 'Tênis de corrida Nike Air Max, R$ 899' });
    const plan = await executePlanningPhase(order);

    assert.ok(plan.id.startsWith('plan-'));
    assert.strictEqual(plan.orderId, order.id);
    assert.ok(plan.providedFacts.productOrService.includes('Tênis'));
    assert.strictEqual(plan.providedFacts.explicitPrice, 'R$ 899');
    assert.ok(plan.inferredCreativeDecisions.alternativeConcepts!.length >= 3);
    assert.ok(plan.compiledPrompt.includes('INTEGRITY MANDATE'));
  });

  it('referências funcionam sem posicionamento manual', async () => {
    const order = createSimpleOrder({
      prompt: 'Anúncio para café gourmet',
      attachmentIds: ['ref-1', 'ref-2'],
    });
    const plan = await executePlanningPhase(order);
    assert.ok(plan.inferredCreativeDecisions.composition.subjectPlacements.length === 2);
  });

  it('sketch funciona sem anexos', async () => {
    const order = createSimpleOrder({
      prompt: 'Banner com layout guiado',
      sketchPaths: [{ id: 's1', tool: 'brush', color: '#000', size: 3, opacity: 1, points: [{ x: 0, y: 0 }] }],
    });
    const plan = await executePlanningPhase(order);
    assert.strictEqual(plan.inferredCreativeDecisions.composition.layoutType, 'sketch_guided');
  });

  it('referências e sketch podem ser combinados', async () => {
    const order = createSimpleOrder({
      prompt: 'Banner com layout guiado e referência',
      attachmentIds: ['ref-1'],
      sketchPaths: [{ id: 's1', tool: 'brush', color: '#000', size: 3, opacity: 1, points: [{ x: 0, y: 0 }] }],
    });
    const plan = await executePlanningPhase(order);
    assert.strictEqual(plan.inferredCreativeDecisions.composition.layoutType, 'sketch_guided');
    assert.ok(plan.inferredCreativeDecisions.composition.subjectPlacements.length === 1);
  });
});

// ---------------------------------------------------------------------------
// 4. Result lineage — immutable versioning
// ---------------------------------------------------------------------------
describe('Result lineage and versioning', () => {
  it('primeiro resultado é initial com versão 1', () => {
    const lineage = buildResultLineage([], 'initial');
    assert.strictEqual(lineage.versionNumber, 1);
    assert.strictEqual(lineage.iterationType, 'initial');
    assert.strictEqual(lineage.parentId, undefined);
  });

  it('cada resultado incrementa versão sem sobrescrever', () => {
    const fakeResults: SketchCreativeResult[] = [
      { id: 'r1' } as SketchCreativeResult,
      { id: 'r2' } as SketchCreativeResult,
    ];
    const lineage = buildResultLineage(fakeResults, 'text_adjustment', 'r2', 'Mude o título');
    assert.strictEqual(lineage.versionNumber, 3);
    assert.strictEqual(lineage.parentId, 'r2');
    assert.strictEqual(lineage.adjustmentPrompt, 'Mude o título');
  });
});

// ---------------------------------------------------------------------------
// 5. Apply result to project — immutable append
// ---------------------------------------------------------------------------
describe('applyResultToProject', () => {
  it('adiciona resultado sem sobrescrever os anteriores', async () => {
    const project = createCleanProject() as SketchProjectData;
    const order = createSimpleOrder({ prompt: 'Teste' });
    const plan = await executePlanningPhase(order);
    const asset = makeFinalAsset();

    const updated1 = applyResultToProject(project, order, plan, asset);
    assert.strictEqual(updated1.creativeResults!.length, 1);
    assert.strictEqual(updated1.activeResultId, updated1.creativeResults![0].id);

    // Second result
    const order2 = createSimpleOrder({ prompt: 'Teste 2' });
    const plan2 = await executePlanningPhase(order2);
    const updated2 = applyResultToProject(updated1, order2, plan2, asset);
    assert.strictEqual(updated2.creativeResults!.length, 2);
    // First result still exists
    assert.strictEqual(updated2.creativeResults![0].id, updated1.creativeResults![0].id);
  });

  it('registra change intent na linhagem', async () => {
    const project = createCleanProject() as SketchProjectData;
    const order = createSimpleOrder({ prompt: 'Original' });
    const plan = await executePlanningPhase(order);
    const asset = makeFinalAsset();
    const updated = applyResultToProject(project, order, plan, asset);

    const intent = createChangeIntent('refine_text', updated.creativeResults![0].id, 'Mude headline');
    const plan2 = await executePlanningPhase(createSimpleOrder({ prompt: 'Mude headline' }));
    const updated2 = applyResultToProject(updated, order, plan2, asset, intent);

    assert.strictEqual(updated2.changeIntents!.length, 1);
    assert.strictEqual(updated2.creativeResults!.length, 2);
    assert.strictEqual(
      updated2.creativeResults![1].lineage.iterationType,
      'text_adjustment'
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Adjustment intelligence
// ---------------------------------------------------------------------------
describe('Adjustment intelligence', () => {
  it('refine_text com base image pode reutilizar', () => {
    const intent = createChangeIntent('refine_text', 'r1', 'Mude título');
    const result = {
      resourcesForAdjustments: { baseImageUrl: 'http://test/img.png' },
    } as SketchCreativeResult;
    assert.strictEqual(canReuseBaseImage(intent, result), true);
  });

  it('refine_visual não reutiliza base image', () => {
    const intent = createChangeIntent('refine_visual', 'r1', 'Mude fundo');
    const result = {
      resourcesForAdjustments: { baseImageUrl: 'http://test/img.png' },
    } as SketchCreativeResult;
    assert.strictEqual(canReuseBaseImage(intent, result), false);
  });

  it('new_concept não reutiliza base image', () => {
    const intent = createChangeIntent('new_concept', 'r1', 'Outra ideia');
    const result = {
      resourcesForAdjustments: { baseImageUrl: 'http://test/img.png' },
    } as SketchCreativeResult;
    assert.strictEqual(canReuseBaseImage(intent, result), false);
  });
});

// ---------------------------------------------------------------------------
// 7. Reference preservation — no silent discard
// ---------------------------------------------------------------------------
describe('validateReferencesPreserved', () => {
  it('reporta referências não processadas', () => {
    const order = createSimpleOrder({
      prompt: 'Teste',
      attachmentIds: ['att-1', 'att-2', 'att-3'],
    });
    const processed = ['att-1', 'att-3'];
    const issues = validateReferencesPreserved(order, processed);
    assert.strictEqual(issues.length, 1);
    assert.ok(issues[0].includes('att-2'));
  });

  it('sem issues quando todas processadas', () => {
    const order = createSimpleOrder({
      prompt: 'Teste',
      attachmentIds: ['att-1', 'att-2'],
    });
    const issues = validateReferencesPreserved(order, ['att-1', 'att-2']);
    assert.strictEqual(issues.length, 0);
  });
});
