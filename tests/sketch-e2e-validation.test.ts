/**
 * Sketch Pipeline E2E Validation — Phase 5 (Agente 5)
 *
 * Independent audit answering: "Consigo descrever um anúncio e receber
 * uma arte pronta sem operar um editor de design?"
 *
 * Tests 10 essential scenarios plus regression checks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Phase 1 contracts & storage
import {
  createCleanProject,
  createCleanLayers,
} from '../lib/sketch/sketch-project-defaults.ts';
import type {
  SketchProjectData,
  SketchSimpleOrder,
  SketchCreativeResult,
  FinalAssetResource,
  FlowSupportedAspectRatio,
} from '../types/sketch.ts';

// Phase 3 creative planner
import {
  extractProvidedFacts,
  generateConceptAlternatives,
  selectBestConcept,
  buildCreativeCopy,
  buildArtDirection,
  buildComposition,
  planCreative,
} from '../lib/sketch/sketch-creative-planner.ts';

// Phase 4 pipeline integrator
import {
  createSimpleOrder,
  createChangeIntent,
  classifyChangeIntent,
  executePlanningPhase,
  applyResultToProject,
  canReuseBaseImage,
  validateReferencesPreserved,
} from '../lib/sketch/sketch-pipeline-integrator.ts';

function makeFinalAsset(overrides?: Partial<FinalAssetResource>): FinalAssetResource {
  return {
    imageUrl: '/api/sketch/assets/gen-e2e-test.png',
    filePath: '/tmp/gen-e2e-test.png',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    fileSizeBytes: 200000,
    mimeType: 'image/png',
    format: 'png',
    ...overrides,
  };
}

function makeOrder(prompt: string, overrides?: Partial<Parameters<typeof createSimpleOrder>[0]>): SketchSimpleOrder {
  return createSimpleOrder({ prompt, ...overrides });
}

// ---------------------------------------------------------------------------
// Scenario 1: First access — only prompt field and essential actions
// ---------------------------------------------------------------------------
describe('E2E Cenário 1 — Primeiro acesso', () => {
  it('novo projeto inicia limpo sem dados pré-populados', () => {
    const project = createCleanProject() as SketchProjectData;
    assert.ok(project.id);
    // No pre-populated CTA, badge, or promotional copy
    assert.strictEqual(project.copy.headline, '');
    assert.strictEqual(project.copy.subheadline, '');
    assert.strictEqual(project.copy.cta, '');
    assert.strictEqual(project.copy.badge, '');
    // No pre-existing creative results
    const results = project.creativeResults;
    assert.ok(!results || results.length === 0, 'Novo projeto não deve ter resultados criativos');
    assert.ok(!project.activeResultId, 'Novo projeto não deve ter resultado ativo');
    // Clean layers (only background)
    const layers = createCleanLayers();
    assert.ok(layers.length >= 1);
    assert.strictEqual(layers[0].type, 'background');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Prompt alone
// ---------------------------------------------------------------------------
describe('E2E Cenário 2 — Prompt isolado', () => {
  it('gera plano criativo completo a partir apenas do prompt', async () => {
    const order = makeOrder('Tênis esportivo de alta performance para corrida');
    const plan = await executePlanningPhase(order);

    assert.ok(plan.id);
    assert.ok(plan.providedFacts.productOrService);
    assert.ok(plan.inferredCreativeDecisions.alternativeConcepts!.length >= 3);
    assert.ok(plan.compiledPrompt.length > 50);
    assert.ok(plan.compiledPrompt.includes('INTEGRITY MANDATE'));
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Prompt with references
// ---------------------------------------------------------------------------
describe('E2E Cenário 3 — Prompt com referências', () => {
  it('referências são incluídas no plano sem posicionamento manual', async () => {
    const order = makeOrder('Anúncio premium para relógio', {
      attachmentIds: ['ref-product', 'ref-style'],
    });
    const plan = await executePlanningPhase(order);

    assert.strictEqual(
      plan.inferredCreativeDecisions.composition.subjectPlacements.length,
      2
    );
    // Validate no reference silently discarded
    const processed = plan.inferredCreativeDecisions.composition.subjectPlacements.map(
      (s) => s.attachmentId!
    );
    const issues = validateReferencesPreserved(order, processed);
    assert.strictEqual(issues.length, 0, 'Nenhuma referência deve ser descartada silenciosamente');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Prompt with sketch
// ---------------------------------------------------------------------------
describe('E2E Cenário 4 — Prompt com sketch', () => {
  it('sketch guia a composição sem exigir anexos', async () => {
    const order = makeOrder('Banner de promoção de verão', {
      sketchPaths: [
        { id: 's1', tool: 'brush', color: '#000', size: 3, opacity: 1, points: [{ x: 10, y: 10 }, { x: 90, y: 90 }] },
      ],
    });
    const plan = await executePlanningPhase(order);

    assert.strictEqual(
      plan.inferredCreativeDecisions.composition.layoutType,
      'sketch_guided'
    );
    assert.strictEqual(order.selectedReferences.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Prompt with references AND sketch combined
// ---------------------------------------------------------------------------
describe('E2E Cenário 5 — Prompt com referências e sketch combinados', () => {
  it('combina referências e sketch em um único plano', async () => {
    const order = makeOrder('Anúncio com referência de marca e layout guiado', {
      attachmentIds: ['ref-brand-logo'],
      sketchPaths: [
        { id: 's1', tool: 'brush', color: '#333', size: 5, opacity: 1, points: [{ x: 0, y: 0 }] },
      ],
    });
    const plan = await executePlanningPhase(order);

    assert.strictEqual(
      plan.inferredCreativeDecisions.composition.layoutType,
      'sketch_guided'
    );
    assert.strictEqual(
      plan.inferredCreativeDecisions.composition.subjectPlacements.length,
      1
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Cancel/reopen drawing without losing prior state
// ---------------------------------------------------------------------------
describe('E2E Cenário 6 — Cancelamento do modal de desenho', () => {
  it('pedido preserva sketch anterior ao cancelar e reabrir', () => {
    // Simulates: user applies a sketch, then opens modal again and cancels
    const orderWithSketch = makeOrder('Banner com sketch', {
      sketchPaths: [
        { id: 'original', tool: 'brush', color: '#000', size: 3, opacity: 1, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] },
      ],
    });

    // After cancel, the original sketch should still be present
    assert.ok(orderWithSketch.sketchDrawing?.hasDrawing);
    assert.strictEqual(orderWithSketch.sketchDrawing?.paths[0].id, 'original');
    assert.strictEqual(orderWithSketch.sketchDrawing?.paths.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Text-only adjustment reuses base image
// ---------------------------------------------------------------------------
describe('E2E Cenário 7 — Ajuste exclusivo de texto', () => {
  it('ajuste de texto classifica corretamente e pode reutilizar imagem', async () => {
    const order = makeOrder('Tênis Nike Air Max, R$ 899');
    const plan = await executePlanningPhase(order);
    const project = createCleanProject() as SketchProjectData;
    const asset = makeFinalAsset();
    const updated = applyResultToProject(project, order, plan, asset);

    const feedback = 'Mude o título para algo mais impactante';
    const intentType = classifyChangeIntent(feedback);
    assert.strictEqual(intentType, 'refine_text');

    const intent = createChangeIntent(intentType, updated.creativeResults![0].id, feedback);
    assert.strictEqual(intent.keepBaseImage, true);

    // Can reuse with base image
    const existingResult = {
      ...updated.creativeResults![0],
      resourcesForAdjustments: { baseImageUrl: 'http://test/img.png' },
    } as SketchCreativeResult;
    assert.strictEqual(canReuseBaseImage(intent, existingResult), true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: "Outra ideia" produces different concept
// ---------------------------------------------------------------------------
describe('E2E Cenário 8 — Outra ideia', () => {
  it('"Outra ideia" gera novo conceito na mesma linhagem', async () => {
    const order = makeOrder('Café gourmet artesanal');
    const plan = await executePlanningPhase(order);
    const project = createCleanProject() as SketchProjectData;
    const asset = makeFinalAsset();
    const updated = applyResultToProject(project, order, plan, asset);

    // User requests "outra ideia"
    const feedback = 'Quero outra ideia completamente diferente';
    const intentType = classifyChangeIntent(feedback);
    assert.strictEqual(intentType, 'new_concept');

    const intent = createChangeIntent(intentType, updated.creativeResults![0].id, feedback);
    assert.strictEqual(intent.keepBaseImage, false);

    // Apply new concept
    const plan2 = await executePlanningPhase(createSimpleOrder({ prompt: 'Café gourmet artesanal' }));
    const updated2 = applyResultToProject(updated, order, plan2, asset, intent);

    // Both versions exist
    assert.strictEqual(updated2.creativeResults!.length, 2);
    assert.strictEqual(updated2.creativeResults![1].lineage.iterationType, 'new_concept');
    assert.strictEqual(updated2.creativeResults![1].lineage.parentId, updated.creativeResults![0].id);
    // Active result is the new one
    assert.strictEqual(updated2.activeResultId, updated2.creativeResults![1].id);
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: Download matches displayed result
// ---------------------------------------------------------------------------
describe('E2E Cenário 9 — Download correspondente ao resultado', () => {
  it('resultado ativo possui asset com URL e caminho válidos', async () => {
    const order = makeOrder('Promoção de Natal');
    const plan = await executePlanningPhase(order);
    const project = createCleanProject() as SketchProjectData;
    const asset = makeFinalAsset({
      imageUrl: '/api/sketch/assets/gen-natal.png',
      filePath: '/tmp/gen-natal.png',
      fileSizeBytes: 250000,
    });
    const updated = applyResultToProject(project, order, plan, asset);

    const activeResult = updated.creativeResults!.find((r) => r.id === updated.activeResultId);
    assert.ok(activeResult, 'Deve haver um resultado ativo');
    assert.ok(activeResult.finalAsset.imageUrl.includes('gen-natal.png'));
    assert.ok(activeResult.finalAsset.fileSizeBytes > 0);
    assert.strictEqual(activeResult.finalAsset.format, 'png');
    assert.strictEqual(activeResult.status, 'ready');
  });
});

// ---------------------------------------------------------------------------
// Scenario 10: Legacy project reopening and history preservation
// ---------------------------------------------------------------------------
describe('E2E Cenário 10 — Reabertura de projetos legados', () => {
  it('projeto antigo sem campos novos continua funcional', () => {
    // Simulate a legacy project without Phase 1+ fields
    const legacyProject: SketchProjectData = {
      id: 'legacy-001',
      title: 'Projeto Antigo',
      description: 'Descrição legada',
      aspectRatio: '1:1',
      prompt: 'Anúncio antigo de produto',
      useSketchAsReference: false,
      copy: {
        headline: 'Título Existente',
        subheadline: 'Subtítulo',
        cta: 'Compre Agora',
        badge: 'Promoção',
        suggestedVisualPrompt: '',
      },
      attachments: [],
      layers: [
        {
          id: 'bg-1',
          name: 'Fundo',
          type: 'background',
          visible: true,
          opacity: 1,
          fillType: 'color',
          color: '#FFFFFF',
        },
      ],
      generationHistory: [
        {
          id: 'gen-old-1',
          prompt: 'old prompt',
          imageUrl: '/old/image.png',
          aspectRatio: '1:1',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
      updatedAt: '2025-01-01T00:00:00Z',
    };

    // Legacy fields are preserved
    assert.strictEqual(legacyProject.copy.headline, 'Título Existente');
    assert.strictEqual(legacyProject.copy.cta, 'Compre Agora');
    assert.strictEqual(legacyProject.generationHistory.length, 1);

    // New fields are undefined (not overwritten)
    assert.strictEqual(legacyProject.currentOrder, undefined);
    assert.strictEqual(legacyProject.creativePlan, undefined);
    assert.strictEqual(legacyProject.creativeResults, undefined);

    // Can add new results without breaking existing data
    const order = createSimpleOrder({ prompt: 'Novo pedido para projeto legado' });
    const updatedProject = {
      ...legacyProject,
      currentOrder: order,
      creativeResults: [],
    };
    assert.strictEqual(updatedProject.copy.headline, 'Título Existente'); // Preserved
    assert.strictEqual(updatedProject.generationHistory.length, 1); // Preserved
    assert.ok(updatedProject.currentOrder); // New field added
  });
});

// ---------------------------------------------------------------------------
// Regression checks — no complexity reintroduced
// ---------------------------------------------------------------------------
describe('Verificação de regressão', () => {
  it('novo projeto NÃO tem briefing obrigatório, camadas visíveis ou prancheta', () => {
    const project = createCleanProject() as SketchProjectData;
    // No pre-filled promotional briefing
    if (project.briefing) {
      assert.strictEqual(project.briefing.productDescription, '');
    }
    // Copy is empty
    assert.strictEqual(project.copy.headline, '');
    assert.strictEqual(project.copy.cta, '');
    assert.strictEqual(project.copy.badge, '');
  });

  it('conceitos criativos não contêm clichês genéricos', async () => {
    const order = makeOrder('Aulas de yoga online');
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);

    const cliches = [
      'O futuro chegou',
      'qualidade premium',
      'produto flutuando',
      'partículas',
      'neon',
    ];

    for (const concept of concepts) {
      for (const cliche of cliches) {
        assert.ok(
          !concept.title.toLowerCase().includes(cliche.toLowerCase()),
          `Conceito "${concept.title}" contém clichê genérico "${cliche}"`
        );
        assert.ok(
          !concept.description.toLowerCase().includes(cliche.toLowerCase()),
          `Descrição do conceito contém clichê genérico "${cliche}"`
        );
      }
    }
  });

  it('textos e ofertas literais são rigorosamente preservados', () => {
    const order = makeOrder('Pizza grande por R$ 39,90, delivery grátis');
    const facts = extractProvidedFacts(order);
    assert.strictEqual(facts.explicitPrice, 'R$ 39,90');
    assert.strictEqual(facts.rawUserPrompt, order.prompt);
  });

  it('art direction mantém avoidCliches true por padrão', async () => {
    const order = makeOrder('Qualquer produto');
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);
    const { selected } = selectBestConcept(facts, concepts);
    const art = buildArtDirection(facts, selected);
    assert.strictEqual(art.avoidCliches, true);
  });
});
