import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProvidedFacts,
  generateConceptAlternatives,
  selectBestConcept,
  buildCreativeCopy,
  buildArtDirection,
  buildComposition,
  planCreative,
} from '../lib/sketch/sketch-creative-planner.ts';
import type {
  SketchSimpleOrder,
  FlowSupportedAspectRatio,
} from '../types/sketch.ts';

function makeOrder(prompt: string, overrides?: Partial<SketchSimpleOrder>): SketchSimpleOrder {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: `order-test-${Date.now()}`,
    prompt,
    aspectRatio: '1:1' as FlowSupportedAspectRatio,
    selectedReferences: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cenário 1: Produto Físico
// ---------------------------------------------------------------------------
describe('Cenário 1 — Produto Físico', () => {
  const order = makeOrder('Tênis de corrida Nike Air Max, amortecimento superior, R$ 899');

  it('extrai fatos corretamente', () => {
    const facts = extractProvidedFacts(order);
    assert.ok(facts.productOrService.includes('Tênis'));
    assert.strictEqual(facts.explicitPrice, 'R$ 899');
    assert.strictEqual(facts.rawUserPrompt, order.prompt);
    assert.ok(facts.mandatoryRestrictions.length === 0);
  });

  it('gera 3 conceitos distintos', () => {
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);
    assert.strictEqual(concepts.length, 3);
    const angles = new Set(concepts.map((c) => c.angle));
    assert.ok(angles.size >= 2, 'Deve ter pelo menos 2 ângulos distintos');
  });

  it('seleciona conceito com justificativa', () => {
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);
    const { selected, rationale } = selectBestConcept(facts, concepts);
    assert.ok(selected.id);
    assert.ok(rationale.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Cenário 2: Serviço
// ---------------------------------------------------------------------------
describe('Cenário 2 — Serviço', () => {
  const order = makeOrder('Aulas de yoga online ao vivo, primeira semana grátis');

  it('extrai fatos de serviço', () => {
    const facts = extractProvidedFacts(order);
    assert.ok(facts.productOrService.includes('Aulas'));
    assert.strictEqual(facts.rawUserPrompt, order.prompt);
  });

  it('copy não inventa preço', () => {
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);
    const { selected } = selectBestConcept(facts, concepts);
    const copy = buildCreativeCopy(facts, selected);
    assert.ok(!copy.headline.includes('R$'), 'Não deve inventar preço');
  });
});

// ---------------------------------------------------------------------------
// Cenário 3: Oferta com Preço Exato
// ---------------------------------------------------------------------------
describe('Cenário 3 — Oferta com Preço Exato', () => {
  const order = makeOrder('Pizza grande por R$ 39,90, delivery grátis acima de R$ 50');

  it('preserva preço literal', () => {
    const facts = extractProvidedFacts(order);
    assert.strictEqual(facts.explicitPrice, 'R$ 39,90');
    assert.ok(facts.productOrService.includes('Pizza'));
  });

  it('copy preserva oferta explícita no badge', () => {
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);
    const { selected } = selectBestConcept(facts, concepts);
    const copy = buildCreativeCopy(facts, selected);
    // Badge should contain the explicit price or offer
    assert.ok(copy.badge, 'Badge deve existir com oferta explícita');
  });
});

// ---------------------------------------------------------------------------
// Cenário 4: Pedido Sem Texto
// ---------------------------------------------------------------------------
describe('Cenário 4 — Pedido Sem Texto', () => {
  const order = makeOrder('Foto artística de um café gourmet, sem texto no anúncio');

  it('identifica restrição sem texto', () => {
    const facts = extractProvidedFacts(order);
    assert.ok(facts.mandatoryRestrictions.includes('sem texto no anúncio'));
  });

  it('copy retorna strings vazias', () => {
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);
    const { selected } = selectBestConcept(facts, concepts);
    const copy = buildCreativeCopy(facts, selected);
    assert.strictEqual(copy.headline, '');
    assert.strictEqual(copy.subheadline, '');
    assert.strictEqual(copy.cta, '');
  });

  it('composição não reserva zonas de copy', () => {
    const facts = extractProvidedFacts(order);
    const comp = buildComposition(order, facts);
    assert.strictEqual(comp.reservedCopyZones.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Cenário 5: Referência de Identidade
// ---------------------------------------------------------------------------
describe('Cenário 5 — Referência de Identidade', () => {
  const order = makeOrder('Anúncio para a marca Natura, cosmético facial anti-idade');

  it('extrai marca do prompt', () => {
    const facts = extractProvidedFacts(order);
    assert.strictEqual(facts.brandName, 'Natura');
  });

  it('art direction mantém avoidCliches true', () => {
    const facts = extractProvidedFacts(order);
    const concepts = generateConceptAlternatives(facts);
    const { selected } = selectBestConcept(facts, concepts);
    const art = buildArtDirection(facts, selected);
    assert.strictEqual(art.avoidCliches, true);
  });
});

// ---------------------------------------------------------------------------
// Cenário 6: Composição com Sketch
// ---------------------------------------------------------------------------
describe('Cenário 6 — Composição Guiada por Sketch', () => {
  const order = makeOrder('Banner de verão para loja de roupas', {
    sketchDrawing: {
      paths: [{ id: 'p1', tool: 'brush', color: '#000', size: 3, opacity: 1, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }],
      hasDrawing: true,
    },
  });

  it('usa sketch_guided como layoutType', () => {
    const facts = extractProvidedFacts(order);
    const comp = buildComposition(order, facts);
    assert.strictEqual(comp.layoutType, 'sketch_guided');
  });

  it('textRenderingStrategy é layer por padrão', () => {
    const facts = extractProvidedFacts(order);
    const comp = buildComposition(order, facts);
    assert.strictEqual(comp.textRenderingStrategy, 'layer');
  });
});

// ---------------------------------------------------------------------------
// Cenário Integrado: planCreative completo
// ---------------------------------------------------------------------------
describe('planCreative — pipeline completo', () => {
  it('gera plano criativo válido para produto físico', async () => {
    const order = makeOrder('Tênis de corrida Nike Air Max, amortecimento superior, R$ 899');
    const plan = await planCreative(order);

    assert.strictEqual(plan.schemaVersion, 1);
    assert.ok(plan.id.startsWith('plan-'));
    assert.strictEqual(plan.orderId, order.id);

    // Provided facts
    assert.ok(plan.providedFacts.productOrService.includes('Tênis'));
    assert.strictEqual(plan.providedFacts.explicitPrice, 'R$ 899');
    assert.strictEqual(plan.providedFacts.rawUserPrompt, order.prompt);

    // Inferred decisions
    const decisions = plan.inferredCreativeDecisions;
    assert.ok(decisions.selectedAngle);
    assert.ok(decisions.angleRationale);
    assert.ok(decisions.alternativeConcepts);
    assert.strictEqual(decisions.alternativeConcepts.length, 3);
    assert.ok(decisions.visualConcept);
    assert.ok(decisions.artDirection.avoidCliches);
    assert.strictEqual(decisions.composition.textRenderingStrategy, 'layer');

    // Compiled prompt
    assert.ok(plan.compiledPrompt.includes('INTEGRITY MANDATE'));
    assert.ok(plan.compiledPrompt.length > 50);
  });

  it('gera plano com copy vazia para pedido sem texto', async () => {
    const order = makeOrder('Foto artística de um café gourmet, sem texto no anúncio');
    const plan = await planCreative(order);

    assert.strictEqual(plan.inferredCreativeDecisions.copy.headline, '');
    assert.strictEqual(plan.inferredCreativeDecisions.copy.cta, '');
    assert.ok(plan.compiledPrompt.includes('No text'));
  });

  it('gera plano com sketch_guided para pedido com sketch', async () => {
    const order = makeOrder('Banner de verão', {
      sketchDrawing: {
        paths: [{ id: 'p1', tool: 'brush', color: '#000', size: 3, opacity: 1, points: [{ x: 0, y: 0 }] }],
        hasDrawing: true,
      },
    });
    const plan = await planCreative(order);
    assert.strictEqual(plan.inferredCreativeDecisions.composition.layoutType, 'sketch_guided');
  });
});
