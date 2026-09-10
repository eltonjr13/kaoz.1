import type {
  SketchSimpleOrder,
  SketchCreativePlan,
  ProvidedFacts,
  ConceptAlternative,
  SellingAngle,
  CreativePlanCopy,
  CreativePlanArtDirection,
  CreativePlanComposition,
  InferredCreativeDecisions,
  CreativeReservedCopyZone,
  CreativeSubjectPlacement,
  SketchOrderReference,
} from '../../types/sketch.ts';

// ---------------------------------------------------------------------------
// 1. Fact Extraction — pure parsing, no LLM, no invention
// ---------------------------------------------------------------------------

const PRICE_REGEX = /R\$\s*\d+(?:[.,]\d+)*/gi;
const PERCENT_REGEX = /\d+%\s*(?:OFF|desc(?:onto)?|de desconto)/gi;
const NO_TEXT_REGEX = /sem\s+texto|without\s+text|no\s+text|apenas?\s+(?:imagem|foto|visual)/i;

function findFirst(text: string, regex: RegExp): string | undefined {
  const m = text.match(regex);
  return m ? m[0].trim() : undefined;
}

function extractAllPrices(text: string): string[] {
  return (text.match(PRICE_REGEX) || []).map((p) => p.trim());
}

function extractProductLine(prompt: string): string {
  // First sentence or first clause up to comma is typically the product
  const first = prompt.split(/[.,;!?\n]/)[0]?.trim();
  return first || prompt.trim().slice(0, 120);
}

function extractBrandFromPrompt(prompt: string): string | undefined {
  const brandMatch = prompt.match(/marca\s+(\S+)/i);
  if (brandMatch) return brandMatch[1].replace(/[.,;:!?]+$/, '');
  // Look for "para a/o <Brand>"
  const paraMatch = prompt.match(/para\s+(?:a|o)\s+(\S+)/i);
  if (paraMatch && /^[A-Z]/.test(paraMatch[1])) return paraMatch[1].replace(/[.,;:!?]+$/, '');
  return undefined;
}

function extractAudienceFromPrompt(prompt: string): string | undefined {
  const audMatch = prompt.match(/(?:para|público|audiência|target)[:\s]+(.+?)(?:[.,;]|$)/i);
  return audMatch ? audMatch[1].trim().slice(0, 100) : undefined;
}

function extractRestrictions(prompt: string): string[] {
  const restrictions: string[] = [];
  if (NO_TEXT_REGEX.test(prompt)) restrictions.push('sem texto no anúncio');
  return restrictions;
}

export function extractProvidedFacts(order: SketchSimpleOrder): ProvidedFacts {
  const prompt = order.prompt || '';
  const prices = extractAllPrices(prompt);
  const discount = findFirst(prompt, PERCENT_REGEX);
  const offerParts: string[] = [];
  if (discount) offerParts.push(discount);
  if (prices.length > 0) offerParts.push(prices[0]);

  return {
    productOrService: extractProductLine(prompt),
    brandName: extractBrandFromPrompt(prompt),
    targetAudience: extractAudienceFromPrompt(prompt),
    explicitOffer: offerParts.length > 0 ? offerParts.join(', ') : undefined,
    explicitPrice: prices[0],
    mandatoryRestrictions: extractRestrictions(prompt),
    rawUserPrompt: prompt,
  };
}

// ---------------------------------------------------------------------------
// 2. Concept Generation — pure heuristic alternatives
// ---------------------------------------------------------------------------

const SELLING_ANGLES: SellingAngle[] = ['desire', 'objection', 'demonstration', 'contrast', 'curiosity'];

interface AngleTemplate {
  titleTemplate: (product: string) => string;
  descTemplate: (product: string) => string;
  hookTemplate: (product: string) => string;
}

const ANGLE_TEMPLATES: Record<SellingAngle, AngleTemplate> = {
  desire: {
    titleTemplate: (p) => `Imagine com ${shortName(p)}`,
    descTemplate: (p) => `Mostra o resultado desejado que ${shortName(p)} proporciona na vida do cliente`,
    hookTemplate: (p) => `Close-up do produto ${shortName(p)} em uso real, com iluminação natural e ambiente aspiracional`,
  },
  objection: {
    titleTemplate: (p) => `Sem desculpas para ${shortName(p)}`,
    descTemplate: (p) => `Derruba a principal objeção de compra com demonstração visual direta de ${shortName(p)}`,
    hookTemplate: (p) => `Comparação sutil antes/depois com ${shortName(p)} em evidência central`,
  },
  demonstration: {
    titleTemplate: (p) => `${shortName(p)} em ação`,
    descTemplate: (p) => `Demonstra o benefício principal de ${shortName(p)} sendo utilizado de forma prática`,
    hookTemplate: (p) => `Cena de uso real de ${shortName(p)} com foco no benefício tangível e iluminação limpa`,
  },
  contrast: {
    titleTemplate: (p) => `A diferença de ${shortName(p)}`,
    descTemplate: (p) => `Cria contraste visual entre a situação sem e com ${shortName(p)}`,
    hookTemplate: (p) => `Composição dividida mostrando contraste: rotina sem vs. com ${shortName(p)}`,
  },
  curiosity: {
    titleTemplate: (p) => `O segredo por trás de ${shortName(p)}`,
    descTemplate: (p) => `Desperta curiosidade revelando um aspecto inesperado de ${shortName(p)}`,
    hookTemplate: (p) => `Enquadramento intrigante de ${shortName(p)} com elemento parcialmente revelado`,
  },
  custom: {
    titleTemplate: (p) => `Descubra ${shortName(p)}`,
    descTemplate: (p) => `Apresentação direta e autêntica de ${shortName(p)}`,
    hookTemplate: (p) => `Composição editorial com ${shortName(p)} em destaque`,
  },
};

function shortName(product: string): string {
  const words = product.split(/\s+/).slice(0, 4);
  return words.join(' ');
}

function pickThreeAngles(facts: ProvidedFacts): SellingAngle[] {
  const angles: SellingAngle[] = [];
  // Always include desire as first option
  angles.push('desire');
  // If there's an explicit offer, objection is strong
  if (facts.explicitOffer || facts.explicitPrice) {
    angles.push('demonstration');
    angles.push('contrast');
  } else {
    angles.push('curiosity');
    angles.push('demonstration');
  }
  return angles.slice(0, 3);
}

function makeConceptId(index: number): string {
  return `concept-${index + 1}`;
}

export function generateConceptAlternatives(facts: ProvidedFacts): ConceptAlternative[] {
  const product = facts.productOrService;
  const angles = pickThreeAngles(facts);

  return angles.map((angle, i) => {
    const tmpl = ANGLE_TEMPLATES[angle];
    return {
      id: makeConceptId(i),
      angle,
      title: tmpl.titleTemplate(product),
      description: tmpl.descTemplate(product),
      visualHook: tmpl.hookTemplate(product),
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Concept Selection — scoring heuristic
// ---------------------------------------------------------------------------

interface ConceptScore {
  relevance: number;
  strength: number;
  feasibility: number;
  clarity: number;
  total: number;
}

function scoreConcept(concept: ConceptAlternative, facts: ProvidedFacts): ConceptScore {
  let relevance = 5;
  let strength = 5;
  const feasibility = 7; // All heuristic concepts are feasible
  const clarity = 6;

  // Boost relevance if concept aligns with offer type
  if (facts.explicitOffer && concept.angle === 'demonstration') relevance += 2;
  if (facts.explicitPrice && concept.angle === 'contrast') relevance += 1;
  if (!facts.explicitOffer && concept.angle === 'desire') strength += 2;

  const total = relevance + strength + feasibility + clarity;
  return { relevance, strength, feasibility, clarity, total };
}

export function selectBestConcept(
  facts: ProvidedFacts,
  concepts: ConceptAlternative[]
): { selected: ConceptAlternative; rationale: string } {
  if (concepts.length === 0) {
    throw new Error('Nenhum conceito disponível para seleção');
  }

  let best = concepts[0];
  let bestScore = scoreConcept(best, facts);

  for (let i = 1; i < concepts.length; i++) {
    const score = scoreConcept(concepts[i], facts);
    if (score.total > bestScore.total) {
      best = concepts[i];
      bestScore = score;
    }
  }

  const rationale = `Selecionado "${best.title}" (ângulo: ${best.angle}) com pontuação ${bestScore.total} — ` +
    `relevância ${bestScore.relevance}, força ${bestScore.strength}, ` +
    `viabilidade ${bestScore.feasibility}, clareza ${bestScore.clarity}.`;

  return { selected: best, rationale };
}

// ---------------------------------------------------------------------------
// 4. Copy Builder — respects no-text requests and literal preservation
// ---------------------------------------------------------------------------

function isNoTextRequest(facts: ProvidedFacts): boolean {
  return facts.mandatoryRestrictions.some((r) => r.includes('sem texto'));
}

export function buildCreativeCopy(
  facts: ProvidedFacts,
  concept: ConceptAlternative
): CreativePlanCopy {
  if (isNoTextRequest(facts)) {
    return { headline: '', subheadline: '', cta: '', badge: undefined, disclaimer: undefined };
  }

  const product = shortName(facts.productOrService);
  const copy: CreativePlanCopy = {
    headline: concept.title,
    subheadline: concept.description.slice(0, 80),
    cta: facts.explicitOffer ? `Aproveite ${facts.explicitOffer}` : 'Saiba Mais',
  };

  if (facts.explicitPrice) {
    copy.badge = facts.explicitPrice;
  } else if (facts.explicitOffer) {
    copy.badge = facts.explicitOffer;
  }

  return copy;
}

// ---------------------------------------------------------------------------
// 5. Art Direction — avoidCliches true by default
// ---------------------------------------------------------------------------

function inferMood(facts: ProvidedFacts): string {
  const lower = facts.rawUserPrompt.toLowerCase();
  if (lower.includes('premium') || lower.includes('luxo')) return 'sofisticado e elegante';
  if (lower.includes('divertido') || lower.includes('jovem')) return 'vibrante e energético';
  if (lower.includes('natural') || lower.includes('orgânico')) return 'natural e acolhedor';
  return 'profissional e convidativo';
}

function inferPalette(facts: ProvidedFacts): string[] {
  const lower = facts.rawUserPrompt.toLowerCase();
  if (lower.includes('vermelho') || lower.includes('red')) return ['#D32F2F', '#FFFFFF', '#212121'];
  if (lower.includes('azul') || lower.includes('blue')) return ['#1565C0', '#FFFFFF', '#E3F2FD'];
  if (lower.includes('verde') || lower.includes('green')) return ['#2E7D32', '#FFFFFF', '#E8F5E9'];
  return ['#1A1A2E', '#E94560', '#FFFFFF'];
}

export function buildArtDirection(
  facts: ProvidedFacts,
  _concept: ConceptAlternative
): CreativePlanArtDirection {
  return {
    colorPalette: inferPalette(facts),
    lighting: 'Iluminação natural com sombras suaves, sem efeitos artificiais excessivos',
    mood: inferMood(facts),
    backgroundStyle: 'Fundo contextual relacionado ao produto, sem elementos genéricos distrativos',
    avoidCliches: true,
  };
}

// ---------------------------------------------------------------------------
// 6. Composition Builder
// ---------------------------------------------------------------------------

function inferLayoutType(
  order: SketchSimpleOrder
): 'rule_of_thirds' | 'centered_hero' | 'diagonal_dynamic' | 'sketch_guided' {
  if (order.sketchDrawing?.hasDrawing) return 'sketch_guided';
  // Default to rule_of_thirds as it works well for most ad formats
  return 'rule_of_thirds';
}

function buildDefaultCopyZones(hasText: boolean): CreativeReservedCopyZone[] {
  if (!hasText) return [];
  return [
    {
      role: 'headline',
      label: 'Título Principal',
      zoneDescription: 'upper-center area',
      x: 10,
      y: 5,
      width: 80,
      height: 15,
    },
    {
      role: 'cta',
      label: 'Chamada para Ação',
      zoneDescription: 'lower-center area',
      x: 25,
      y: 80,
      width: 50,
      height: 10,
    },
  ];
}

function buildDefaultSubjectPlacements(
  refs: SketchOrderReference[]
): CreativeSubjectPlacement[] {
  return refs.map((ref, i) => ({
    attachmentId: ref.attachmentId,
    role: ref.role || 'product',
    label: ref.name || `Referência ${i + 1}`,
    zoneDescription: 'middle-center area',
    x: 20 + i * 10,
    y: 20,
    width: 60,
    height: 60,
  }));
}

export function buildComposition(
  order: SketchSimpleOrder,
  facts: ProvidedFacts
): CreativePlanComposition {
  const hasText = !isNoTextRequest(facts);
  return {
    layoutType: inferLayoutType(order),
    reservedCopyZones: buildDefaultCopyZones(hasText),
    subjectPlacements: buildDefaultSubjectPlacements(order.selectedReferences || []),
    textRenderingStrategy: 'layer',
  };
}

// ---------------------------------------------------------------------------
// 7. Compiled Prompt Builder
// ---------------------------------------------------------------------------

function buildCompiledPrompt(
  facts: ProvidedFacts,
  concept: ConceptAlternative,
  artDirection: CreativePlanArtDirection
): string {
  const sections: string[] = [];

  sections.push(`Commercial advertising photograph for ${facts.productOrService}.`);
  sections.push(`Visual concept: ${concept.visualHook}.`);
  sections.push(`Mood: ${artDirection.mood}. Lighting: ${artDirection.lighting}.`);
  sections.push(`Background: ${artDirection.backgroundStyle}.`);

  if (isNoTextRequest(facts)) {
    sections.push('No text, typography, or lettering in the image.');
  } else {
    sections.push(
      'Reserve clean negative space for headline and CTA typography overlay. ' +
      'Do NOT render any text, words, or letters in the image.'
    );
  }

  sections.push(
    'INTEGRITY MANDATE: Do not hallucinate, invent, or add non-existent product features, ' +
    'unstated prices, unauthorized discounts, or fictitious testimonials.'
  );

  return sections.join(' ');
}

// ---------------------------------------------------------------------------
// 8. Validation
// ---------------------------------------------------------------------------

function validatePlan(
  facts: ProvidedFacts,
  plan: InferredCreativeDecisions,
  compiledPrompt: string
): string[] {
  const issues: string[] = [];

  if (!facts.productOrService) {
    issues.push('Nenhum produto ou serviço identificado no pedido.');
  }

  if (!plan.alternativeConcepts || plan.alternativeConcepts.length < 3) {
    issues.push('Menos de 3 conceitos alternativos foram gerados.');
  }

  if (!compiledPrompt.includes('INTEGRITY MANDATE')) {
    issues.push('Mandato de integridade ausente no prompt compilado.');
  }

  if (isNoTextRequest(facts) && plan.copy.headline) {
    issues.push('Pedido sem texto contém headline preenchida no plano.');
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 9. Main Orchestrator — planCreative
// ---------------------------------------------------------------------------

let idCounter = 0;
function generatePlanId(): string {
  idCounter += 1;
  return `plan-${Date.now()}-${idCounter}`;
}

export async function planCreative(
  order: SketchSimpleOrder,
  _queryFn?: (prompt: string) => Promise<string>
): Promise<SketchCreativePlan> {
  const facts = extractProvidedFacts(order);
  const concepts = generateConceptAlternatives(facts);
  const { selected, rationale } = selectBestConcept(facts, concepts);
  const copy = buildCreativeCopy(facts, selected);
  const artDirection = buildArtDirection(facts, selected);
  const composition = buildComposition(order, facts);
  const compiledPrompt = buildCompiledPrompt(facts, selected, artDirection);

  const inferredDecisions: InferredCreativeDecisions = {
    selectedAngle: selected.angle,
    angleRationale: rationale,
    alternativeConcepts: concepts,
    visualConcept: selected.visualHook,
    copy,
    artDirection,
    composition,
  };

  const validationIssues = validatePlan(facts, inferredDecisions, compiledPrompt);

  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: generatePlanId(),
    orderId: order.id,
    providedFacts: facts,
    inferredCreativeDecisions: inferredDecisions,
    compiledPrompt,
    validationIssues,
    createdAt: new Date().toISOString(),
  };
}
