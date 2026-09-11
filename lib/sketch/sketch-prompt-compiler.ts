import {
  type SketchProjectData,
  type SketchGenerationRequest,
  type SketchLayer,
  type SketchAttachment,
  type TextLayer,
  type ImageLayer,
  type SketchReferenceRole,
  type CompositionIntent,
  type TextRenderingStrategy,
  type CreativeReservedCopyZone,
  type CreativeSubjectPlacement,
  type CreativeCompositionGuide,
  type CreativeGenerationCompiledRequest,
  type SketchBriefingData,
  type SketchCopyData,
} from '../../types/sketch.ts';
import {
  prepareSketchCompositeReference,
  type PrepareSketchCompositeOptions,
} from './sketch-composite-preparer.ts';

function describeHorizontalZone(x: number): string {
  if (x < 33) return 'left';
  if (x > 66) return 'right';
  return 'center';
}

function describeVerticalZone(y: number): string {
  if (y < 33) return 'upper';
  if (y > 66) return 'lower';
  return 'middle';
}

export function describeZone(x: number, y: number): string {
  const v = describeVerticalZone(y);
  const h = describeHorizontalZone(x);
  return `${v}-${h} area`;
}

const ROLE_PURPOSES: Record<SketchReferenceRole, string> = {
  product: 'main commercial product',
  person: 'human spokesperson or model',
  logo: 'brand logo identity mark',
  style: 'lighting, color, and aesthetic mood reference',
  composition: 'layout framing and spatial balance guide',
  background: 'background environment setting',
};

export function describeRolePurpose(role?: SketchReferenceRole): string {
  if (!role) return 'visual element';
  return ROLE_PURPOSES[role] || 'visual element';
}

function buildReservedCopyZone(layer: TextLayer): CreativeReservedCopyZone {
  const zone = describeZone(layer.x, layer.y);
  return {
    role: layer.role,
    label: layer.name || `Text (${layer.role})`,
    zoneDescription: zone,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  };
}

export function extractCopyZones(layers: SketchLayer[]): CreativeReservedCopyZone[] {
  const zones: CreativeReservedCopyZone[] = [];
  for (const layer of layers) {
    if (layer.type === 'text' && layer.visible !== false) {
      zones.push(buildReservedCopyZone(layer as TextLayer));
    }
  }
  return zones;
}

function resolveAttachmentRole(
  layer: ImageLayer,
  attachments?: SketchAttachment[]
): SketchReferenceRole {
  if (layer.role) return layer.role as SketchReferenceRole;
  if (layer.attachmentId && attachments) {
    const found = attachments.find((a) => a.id === layer.attachmentId);
    if (found?.role) return found.role as SketchReferenceRole;
  }
  return 'product';
}

export function extractSubjectPlacements(
  layers: SketchLayer[],
  attachments?: SketchAttachment[]
): CreativeSubjectPlacement[] {
  const placements: CreativeSubjectPlacement[] = [];
  for (const layer of layers) {
    if (layer.type !== 'image' || layer.visible === false || layer.isGuide) continue;
    const imgLayer = layer as ImageLayer;
    const role = resolveAttachmentRole(imgLayer, attachments);
    const zone = describeZone(imgLayer.x, imgLayer.y);
    placements.push({
      attachmentId: imgLayer.attachmentId,
      role,
      label: imgLayer.name || `Asset (${role})`,
      zoneDescription: zone,
      x: imgLayer.x,
      y: imgLayer.y,
      width: imgLayer.width,
      height: imgLayer.height,
    });
  }
  return placements;
}

export function extractCompositionGuides(layers: SketchLayer[]): CreativeCompositionGuide[] {
  const guides: CreativeCompositionGuide[] = [];
  for (const layer of layers) {
    const isGuideLayer = Boolean(
      layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation'
    );
    if (isGuideLayer) {
      guides.push({
        id: layer.id,
        label: layer.name,
        instruction: `Guide layer "${layer.name}" orients composition layout`,
        isAnnotation: layer.elementKind === 'annotation',
      });
    }
    if (layer.type === 'sketch') {
      for (const p of layer.paths) {
        if (p.isGuide) {
          guides.push({
            id: p.id,
            label: p.boxLabel || 'Sketch Guide',
            instruction: p.boxLabel || 'Spatial layout framing boundary',
            isAnnotation: true,
          });
        }
      }
    }
  }
  return guides;
}

export function buildCompositionIntentInstruction(intent: CompositionIntent = 'follow'): string {
  if (intent === 'explore') {
    return 'Composition mode: Explore composition. Use the layout sketch and references as flexible creative guidance for camera framing and focal distribution, allowing dynamic studio composition while preserving subject hierarchy.';
  }
  return 'Composition mode: Follow composition. Adhere strictly to the spatial placement, framing boundaries, and focal proportions indicated in the layout reference.';
}

function buildTextZonesClause(zones: CreativeReservedCopyZone[]): string {
  if (zones.length === 0) return 'designated text regions';
  return zones.map((z) => `${z.role} in ${z.zoneDescription}`).join(', ');
}

function hasCopyText(copy?: SketchCopyData): boolean {
  if (!copy) return false;
  return Boolean(copy.headline || copy.subheadline || copy.cta || copy.badge);
}

export function buildTextStrategyInstruction(
  strategy: TextRenderingStrategy = 'layer',
  copy: SketchCopyData,
  zones: CreativeReservedCopyZone[]
): string {
  // Without real copy there is nothing to render and nothing to reserve. The
  // previous behaviour reserved zones for leftover campaign text and produced
  // finished ads with empty typography banners.
  if (!hasCopyText(copy)) {
    return 'Text rendering strategy: No text in the image. Do NOT render, generate, or burn any typography, printed words, letters, headline text, call-to-action buttons, badges, or logos. Keep surfaces clean and uncluttered, and do not leave artificial empty banners or placeholder boxes. Never draw placeholder words, dummy labels, empty buttons, banners, badges or blank rectangles.';
  }

  if (strategy === 'baked') {
    const parts: string[] = [];
    if (copy.headline) parts.push(`Headline: "${copy.headline}"`);
    if (copy.subheadline) parts.push(`Subheadline: "${copy.subheadline}"`);
    if (copy.cta) parts.push(`CTA: "${copy.cta}"`);
    if (copy.badge) parts.push(`Badge: "${copy.badge}"`);
    const copyText = parts.join(', ');
    return `Text rendering strategy: Baked in image. Render the following advertising copy visibly with clean commercial typography: ${copyText}. Preserve every character inside quotes exactly as written without translating, altering, or adding text.`;
  }

  const zonesClause = buildTextZonesClause(zones);
  return `Text rendering strategy: Layered typography overlay. Reserve clean, low-clutter, copy-safe negative space in ${zonesClause}. No text in image. Do NOT render, generate, or burn any typography, printed words, letters, headline text, call-to-action buttons, or logos into the image. Never draw placeholder words, dummy labels, the words "headline", "subheadline", "cta", empty buttons, banners, badges or blank rectangles inside those areas: keep them as plain, uncluttered background surfaces for post-generation typography layers.`;
}

/**
 * The layout guide is a blueprint, never artwork. Without this instruction the
 * generator reproduces the pasted photos, their frames and the board itself.
 */
export function buildReferenceGuideInstruction(hasCompositeReference?: boolean): string {
  if (!hasCompositeReference) return '';
  return [
    'Reference handling: the attached image is a rough layout guide assembled from reference photographs and hand-drawn marks.',
    'Use it only to understand where each referenced subject should sit and how much of the frame it should occupy.',
    'Do NOT reproduce the guide itself: no pasted photographs, photo frames, borders, paper or white-board backgrounds, collage panels, screens, posters, translucent overlays, hand-drawn arrows, letters or labels.',
    'Rebuild every referenced subject inside one continuous finished scene, at full opacity, with believable scale, contact shadows and one consistent lighting setup.',
  ].join(' ');
}

export function buildSceneCohesionInstruction(subjectCount = 0, hasSketch = false): string {
  const parts = [
    'Single-scene rule: build one coherent image where every referenced subject exists in the same space at the same moment.',
    'Do not split the frame into panels, collages, picture-in-picture, framed prints, catalog cards or side-by-side product shots unless the user explicitly asked for that format.',
  ];
  if (subjectCount > 1) {
    parts.push('Show how the referenced subjects relate to each other through pose, gaze, scale and spatial contact.');
  }
  if (hasSketch) {
    parts.push('Hand-drawn marks only indicate placement and proportion; they are not part of the artwork.');
  }
  return parts.join(' ');
}

const QUOTED_WORDING_REGEX = /["“”'’]([^"“”'’]{2,90})["“”'’]/;
const VISIBLE_TEXT_REQUEST_REGEX = /\b(chamada de a[cç][aã]o|cta|call to action|com texto|texto na imagem|headline|t[ií]tulo|selo|frase|bot[aã]o)\b/i;

/** Exact wording the user typed inside quotes, when present. */
export function extractRequestedWording(prompt?: string): string | undefined {
  const match = QUOTED_WORDING_REGEX.exec(prompt || '');
  const wording = match?.[1]?.trim();
  return wording && wording.length >= 2 ? wording : undefined;
}

/** The user asked for visible typography, with or without the exact words. */
export function requestsVisibleText(prompt?: string): boolean {
  return VISIBLE_TEXT_REQUEST_REGEX.test(prompt || '');
}

export function buildGuidesDirective(guides: CreativeCompositionGuide[]): string {
  if (guides.length === 0) return '';
  const noteTexts = guides.map((g) => g.instruction).join('; ');
  return `Composition direction notes: ${noteTexts}. NOTICE: These notes are creative art direction guides for layout and lighting only; they must strictly NOT be rendered as printed text, handwriting, arrows, labels, or visible words on the final ad image.`;
}

function appendBriefingIdentity(segments: string[], b: SketchBriefingData): void {
  if (b.brandName) segments.push(`Brand: "${b.brandName}"`);
  const aud = b.targetAudience || b.audience;
  if (aud) segments.push(`Audience: "${aud}"`);
  if (b.objective) segments.push(`Objective: "${b.objective}"`);
  if (b.offer) segments.push(`Offer: "${b.offer}"`);
}

function appendBriefingStyling(segments: string[], b: SketchBriefingData): void {
  const benefits = b.keyBenefits || b.benefits;
  if (benefits && benefits.length > 0) segments.push(`Key Benefits: "${benefits.join(', ')}"`);
  if (b.tone) segments.push(`Tone: "${b.tone}"`);
  if (b.visualStyle) segments.push(`Visual Style: "${b.visualStyle}"`);
  const colors = b.colorPalette || b.colors;
  if (colors && colors.length > 0) segments.push(`Color Palette: "${colors.join(', ')}"`);
}

function appendBriefingDetails(segments: string[], b?: SketchBriefingData): void {
  if (!b) return;
  appendBriefingIdentity(segments, b);
  appendBriefingStyling(segments, b);
}

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveProductLabel(briefing?: SketchBriefingData): string {
  const product = trimOrEmpty(briefing?.product);
  const description = trimOrEmpty(briefing?.productDescription);
  if (!product) return description;
  if (!description) return product;
  if (description.toLowerCase().startsWith(product.toLowerCase())) return description;
  return `${product} — ${description}`;
}

export function buildBriefingDirective(briefing?: SketchBriefingData): string {
  // Without a real briefing the directive must stay silent. A generic product
  // placeholder used to override the user's own idea, so it no longer exists.
  const segments: string[] = [];
  const label = resolveProductLabel(briefing);
  if (label) segments.push(`Product: ${label}`);
  appendBriefingDetails(segments, briefing);

  const contextStr = segments.length > 0 ? `${segments.join('. ')}. ` : '';
  return `${contextStr}INTEGRITY MANDATE: Do not hallucinate, invent, or add non-existent product features, unstated prices, unauthorized discounts, or fictitious testimonials. Base composition strictly on stated attributes.`;
}

function describeProportion(width: number, height: number): string {
  const wDesc = width > 60 ? 'prominent framing' : width < 30 ? 'compact scale' : 'balanced proportion';
  const hDesc = height > 60 ? 'prominent vertical scale' : height < 30 ? 'compact vertical scale' : 'balanced vertical proportion';
  return `${wDesc} and ${hDesc}`;
}

export function buildPlacementsDirective(placements: CreativeSubjectPlacement[]): string {
  if (placements.length === 0) return '';
  const items = placements.map(
    (p) => `${describeRolePurpose(p.role)} positioned in ${p.zoneDescription} with ${describeProportion(p.width, p.height)}`
  );
  return `Spatial subject placement: ${items.join('; ')}.`;
}

export interface CreativeCompileInput {
  prompt: string;
  briefing?: SketchBriefingData;
  copy: SketchCopyData;
  layers: SketchLayer[];
  attachments: SketchAttachment[];
  compositionIntent?: CompositionIntent;
  textRenderingStrategy?: TextRenderingStrategy;
  hasSketch?: boolean;
  hasCompositeReference?: boolean;
  subjectCount?: number;
  subjectRoles?: CreativeSubjectRole[];
  changeIntent?: SketchChangeRequest;
}

export interface SketchChangeRequest {
  type: 'refine_text' | 'refine_visual' | 'new_concept';
  userFeedback?: string;
}

const GENERIC_CONCEPT_LABELS = /^(outra ideia|another idea|nova ideia)$/i;

/**
 * The studio offers "Outra ideia" and "O que você quer mudar?". Without this
 * directive those requests were sent to the API and dropped, so the generator
 * produced the same concept again.
 */
export function buildChangeDirective(change?: SketchChangeRequest): string {
  if (!change?.type) return '';
  const feedback = (change.userFeedback || '').trim();

  if (change.type === 'new_concept') {
    const note = feedback && !GENERIC_CONCEPT_LABELS.test(feedback) ? ` User note: ${feedback}.` : '';
    return `Iteration request: produce a clearly different creative concept from the previous version. Change the environment, staging, camera angle, lighting mood and props while keeping the same product, the referenced identities and every stated fact, and do not reuse the previous layout.${note}`;
  }

  if (!feedback) return '';
  const scope = change.type === 'refine_visual' ? 'apply this visual adjustment' : 'apply this adjustment';
  return `Iteration request: ${scope} requested by the user: ${feedback}. Change only what the adjustment asks for and keep everything else consistent: same subjects, identity, product design and materials.`;
}

export interface CreativeSubjectRole {
  role: SketchReferenceRole;
  label?: string;
}

const SUBJECT_ROLE_INSTRUCTIONS: Record<SketchReferenceRole, string> = {
  product: 'preserve the exact product design, materials and proportions',
  person: 'preserve the human identity, face and body',
  logo: 'preserve the brand mark shape and colors exactly',
  style: 'borrow only palette, light and mood',
  composition: 'use only as framing and layout guidance',
  background: 'use as the environment reference',
};

/**
 * The simple flow tags each attached image with a role. Without this directive
 * the generator has to guess which photograph is the person and which one is
 * the product being advertised.
 */
export function buildSubjectRolesDirective(subjects: CreativeSubjectRole[] = []): string {
  if (subjects.length === 0) return '';
  const parts = subjects.map((subject) => {
    const instruction = SUBJECT_ROLE_INSTRUCTIONS[subject.role] || SUBJECT_ROLE_INSTRUCTIONS.product;
    return subject.label ? `${subject.role} (${subject.label}): ${instruction}` : `${subject.role}: ${instruction}`;
  });
  return `Referenced subjects: ${parts.join('; ')}.`;
}

export function compileCreativeGenerationPrompt(input: CreativeCompileInput): string {
  const intent = input.compositionIntent || 'follow';
  const strategy = input.textRenderingStrategy || 'layer';
  const zones = extractCopyZones(input.layers);
  const placements = extractSubjectPlacements(input.layers, input.attachments);
  const guides = extractCompositionGuides(input.layers);

  const sections: string[] = [];
  pushSection(sections, buildIdeaSection(input.prompt));
  pushSection(sections, buildChangeDirective(input.changeIntent));
  sections.push(buildOutputFormatInstruction());
  sections.push(buildBriefingDirective(input.briefing));
  sections.push(buildCompositionIntentInstruction(intent));
  pushSection(sections, buildReferenceGuideInstruction(input.hasCompositeReference));
  sections.push(buildSceneCohesionInstruction(input.subjectCount ?? placements.length, Boolean(input.hasSketch)));
  pushSection(sections, buildSubjectRolesDirective(input.subjectRoles));
  pushSection(sections, buildPlacementsDirective(placements));
  sections.push(buildTextStrategyInstruction(strategy, input.copy, zones));
  pushSection(sections, buildGuidesDirective(guides));
  pushSection(sections, buildSketchNote(input.hasSketch));

  return sections.join(' ');
}

function pushSection(sections: string[], section: string): void {
  if (section) sections.push(section);
}

function buildIdeaSection(prompt?: string): string {
  const idea = typeof prompt === 'string' ? prompt.trim() : '';
  if (!idea) return '';
  // The user's own words come first and stay unquoted so the text-intent
  // heuristic never mistakes the idea for typography to render in the image.
  const normalizedIdea = /[.!?]$/.test(idea) ? idea : `${idea}.`;
  return `Primary creative idea (highest priority): ${normalizedIdea}`;
}

function buildSketchNote(hasSketch?: boolean): string {
  if (!hasSketch) return '';
  return 'Layout sketch guide: Spatial composition guide only; render a finished photorealistic commercial advertising photograph and do not keep or reproduce rough sketch lines, scribbles, pencil marks, or wireframe boxes. Translate every drawn mark into real rendered subjects: never draw stick figures, doodles, arrows, symbols or cartoon outlines, and never replace a photographed person with a drawn character.';
}

/**
 * The studio always produces advertising. Without this line a short request can
 * be interpreted as a generic scene instead of a finished ad image.
 */
export function buildOutputFormatInstruction(): string {
  return 'Output format: one finished commercial advertising image, professionally lit and ready to publish.';
}

function hasTextProhibition(lower: string): boolean {
  return lower.includes('do not render') || lower.includes('no text in image') || lower.includes('without text');
}

function hasBakedDirective(lower: string): boolean {
  if (lower.includes('render the following advertising copy') || lower.includes('baked in image')) {
    return true;
  }
  if (lower.includes('render only the explicitly requested wording')) {
    return true;
  }
  return lower.includes('headline:') && lower.includes('subheadline:');
}

function checkStrategyContradictions(
  lower: string,
  strategy: TextRenderingStrategy,
  issues: string[]
): void {
  if (strategy === 'layer' && hasBakedDirective(lower)) {
    issues.push('Contradição detectada: a estratégia é camadas de texto (espaço negativo), mas o prompt inclui instruções para renderizar texto impresso na imagem.');
  } else if (strategy === 'baked' && hasTextProhibition(lower) && !lower.includes('baked in image')) {
    issues.push('Contradição detectada: a estratégia é texto na imagem, mas o prompt proíbe a renderização de texto.');
  }
}

function checkScribbleRisk(
  lower: string,
  hasSketch: boolean | undefined,
  issues: string[]
): void {
  const hasScribblePreservation =
    lower.includes('pencil sketch style') ||
    lower.includes('preserve scribbles') ||
    lower.includes('keep sketch lines') ||
    lower.includes('wireframe style') ||
    lower.includes('doodle style');

  if (hasScribblePreservation) {
    issues.push('Alerta de qualidade: o prompt contém instruções que podem preservar o estilo de rabiscos ou wireframe na imagem final.');
  }

  const hasAntiScribbleSafeguard =
    lower.includes('do not keep or reproduce rough sketch lines') ||
    lower.includes('do not reproduce sketch lines') ||
    lower.includes('without sketch lines');

  if (hasSketch && !hasAntiScribbleSafeguard) {
    issues.push('Alerta de salvaguarda: sketch ativo como referência sem instrução explícita para evitar rabiscos no anúncio final.');
  }
}

function checkTruncation(prompt: string, issues: string[], maxWords = 320): void {
  const words = prompt.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    issues.push(`Alerta de truncamento: o prompt preparado excede ${maxWords} palavras (${words.length} palavras) e corre risco de corte no FlowProvider.`);
  }

  const quoteCount = (prompt.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    issues.push('Alerta de integridade: aspas não fechadas detectadas no prompt, sugerindo corte abrupto de texto.');
  }

  const trimmed = prompt.trim();
  if (trimmed && !/[.!?"]$/.test(trimmed)) {
    issues.push('Alerta de integridade: o prompt termina sem pontuação final completa, sugerindo possível truncamento.');
  }

  const hasIntegrity = prompt.includes('INTEGRITY MANDATE') || prompt.toLowerCase().includes('do not hallucinate');
  if (!hasIntegrity) {
    issues.push('Alerta de integridade: mandato de integridade contra alucinação de dados não foi incluído no prompt.');
  }
}

export interface ValidateCreativePromptOptions {
  hasSketch?: boolean;
  briefing?: SketchBriefingData;
  copy?: SketchCopyData;
  maxWords?: number;
}

function normalizeForComparison(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Guards the user's own idea against silent loss during prompt preparation.
 * Short ideas are skipped: they are too generic to prove a real match.
 */
export function checkIdeaPreservation(prompt: string, idea?: string): string[] {
  const normalizedIdea = normalizeForComparison(typeof idea === 'string' ? idea : '');
  if (normalizedIdea.length < 12) return [];

  const sentences = normalizedIdea.split(/(?<=[.!?])\s+/);
  const tail = sentences[sentences.length - 1] || normalizedIdea;
  const needle = tail.length >= 12 ? tail : normalizedIdea;

  if (normalizeForComparison(prompt).includes(needle)) return [];

  return [
    'Alerta de fidelidade: a ideia original do usuário não aparece integralmente no prompt enviado ao Flow.',
  ];
}

export function validateCreativePrompt(
  prompt: string,
  strategy: TextRenderingStrategy = 'layer',
  options?: ValidateCreativePromptOptions
): string[] {
  const issues: string[] = [];
  const lower = prompt.toLowerCase();
  checkStrategyContradictions(lower, strategy, issues);
  checkScribbleRisk(lower, options?.hasSketch, issues);
  checkTruncation(prompt, issues, options?.maxWords);
  return issues;
}

export function compileCreativeGenerationRequest(
  project: SketchProjectData,
  options?: PrepareSketchCompositeOptions
): SketchGenerationRequest {
  return prepareSketchCompositeReference(project, options);
}
