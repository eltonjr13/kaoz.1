import {
  type FlowSupportedAspectRatio,
  type SketchCanvasAspectRatio,
  type SketchProjectData,
  type SketchGenerationRequest,
  type SketchCompositePreview,
  type SketchReferenceDiagnostic,
  type SketchReferenceRole,
  type SketchLayer,
  type SketchAttachment,
  type SketchCopyData,
  type CompositionIntent,
  type TextRenderingStrategy,
  type ImageLayer,
  type SketchDrawingLayer,
  type CreativeGenerationCompiledRequest,
  resolveProviderAspectRatio,
  ASPECT_RATIO_PRESETS,
} from '../../types/sketch.ts';
import { prepareFlowImagePrompt } from '../ai/image-prompt-engineering.ts';
import type { ImageReferenceKind } from '../../src/providers/flow/ImageGenerationContract.ts';

/**
 * The Sketch prompt is curated by this pipeline, not free-form LLM text, so it
 * gets a larger budget than the chat paths. The extension types the exact text
 * and the hard provider limit is 16000 characters.
 */
export const SKETCH_PROMPT_MAX_WORDS = 560;
import {
  compileCreativeGenerationPrompt,
  validateCreativePrompt,
  checkIdeaPreservation,
  extractRequestedWording,
  requestsVisibleText,
  extractCopyZones,
  extractSubjectPlacements,
  extractCompositionGuides,
  type CreativeSubjectRole,
} from './sketch-prompt-compiler.ts';

interface SketchAnalysis {
  hasSketch: boolean;
  pathCount: number;
  guideCount: number;
  sketchLayer?: SketchDrawingLayer;
}

export function detectSketchPresence(
  layers: SketchLayer[],
  useSketchAsReference = true
): SketchAnalysis {
  let hasSketch = false;
  let pathCount = 0;
  let guideCount = 0;
  let sketchLayer: SketchDrawingLayer | undefined;

  for (const layer of layers) {
    if (layer.type === 'sketch' && layer.visible && layer.exportToProvider !== false) {
      sketchLayer = layer;
      for (const path of layer.paths) {
        if (path.isGuide) {
          guideCount++;
        } else {
          pathCount++;
          if (useSketchAsReference) {
            hasSketch = true;
          }
        }
      }
    }
  }

  return { hasSketch, pathCount, guideCount, sketchLayer };
}

export interface PlacedImagesAnalysis {
  placedImages: ImageLayer[];
  placedAttachmentIds: Set<string>;
  roles: Set<SketchReferenceRole>;
  hasProductImage: boolean;
  hasSubjectImage: boolean;
}

function resolveImageLayerRole(layer: ImageLayer, attachments?: SketchAttachment[]): SketchReferenceRole | undefined {
  if (layer.role) return layer.role as SketchReferenceRole;
  if (layer.attachmentId && attachments) {
    const att = attachments.find((a) => a.id === layer.attachmentId);
    if (att?.role) return att.role as SketchReferenceRole;
  }
  return undefined;
}

function isEligibleImageLayer(layer: SketchLayer): layer is ImageLayer {
  if (layer.type !== 'image') return false;
  const isGuide = Boolean(layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation');
  if (!layer.visible || isGuide || layer.exportToProvider === false) return false;
  return Boolean(layer.imageUrl);
}

function classifyRoleFlags(r?: SketchReferenceRole): { isProduct: boolean; isSubject: boolean } {
  if (!r) return { isProduct: false, isSubject: true };
  const isProduct = r === 'product';
  const isSubject = isProduct || r === 'person' || r === 'logo';
  return { isProduct, isSubject };
}

export function detectPlacedImages(
  layers: SketchLayer[],
  attachments?: SketchAttachment[]
): PlacedImagesAnalysis {
  const placedImages: ImageLayer[] = [];
  const placedAttachmentIds = new Set<string>();
  const roles = new Set<SketchReferenceRole>();
  let hasProductImage = false;
  let hasSubjectImage = false;

  for (const layer of layers) {
    if (!isEligibleImageLayer(layer)) continue;

    placedImages.push(layer);
    if (layer.attachmentId) placedAttachmentIds.add(layer.attachmentId);

    const r = resolveImageLayerRole(layer, attachments);
    if (r) roles.add(r);

    const flags = classifyRoleFlags(r);
    if (flags.isProduct) hasProductImage = true;
    if (flags.isSubject) hasSubjectImage = true;
  }

  return { placedImages, placedAttachmentIds, roles, hasProductImage, hasSubjectImage };
}

export function checkUnplacedAttachments(
  attachments: SketchAttachment[],
  placedAttachmentIds: Set<string>,
  activeReferenceId?: string,
  selectedReferenceIds?: Set<string>
): SketchReferenceDiagnostic[] {
  const diagnostics: SketchReferenceDiagnostic[] = [];

  for (const att of attachments) {
    const isPlaced = placedAttachmentIds.has(att.id);
    const isActiveRef = activeReferenceId === att.id;
    const isSelectedRef = selectedReferenceIds?.has(att.id) === true;

    if (!isPlaced && !isActiveRef && !isSelectedRef) {
      diagnostics.push({
        code: 'UNPLACED_ATTACHMENT',
        severity: 'warning',
        message: `Anexo "${att.name}" (função: ${att.role}) não está posicionado na prancheta nem selecionado como referência. Para incluí-lo na composição única, posicione-o na prancheta.`,
        attachmentId: att.id,
        role: att.role,
      });
    }
  }

  return diagnostics;
}

function collectIncludedRoles(
  hasSketch: boolean,
  placedRoles: Set<SketchReferenceRole>
): SketchReferenceRole[] {
  const roles: SketchReferenceRole[] = [];
  if (hasSketch) roles.push('composition');
  for (const role of placedRoles) {
    if (!roles.includes(role)) roles.push(role);
  }
  return roles;
}

function resolveReferenceKindWithoutSketch(
  hasSubjectImage: boolean,
  placedRoles: Set<SketchReferenceRole>,
  activeRefRole?: SketchReferenceRole
): { mode: 'none' | 'identity'; kind?: ImageReferenceKind } {
  if (hasSubjectImage || activeRefRole === 'product' || activeRefRole === 'person' || activeRefRole === 'logo') {
    return { mode: 'identity', kind: 'identity' };
  }
  if (placedRoles.has('style') || activeRefRole === 'style') {
    return { mode: 'identity', kind: 'style' };
  }
  if (placedRoles.size > 0 || Boolean(activeRefRole)) {
    return { mode: 'identity', kind: 'identity' };
  }
  return { mode: 'none', kind: undefined };
}

function hasAnySubject(
  hasSubjectImage: boolean,
  activeRefRole?: SketchReferenceRole
): boolean {
  if (hasSubjectImage) return true;
  return activeRefRole === 'product' || activeRefRole === 'person' || activeRefRole === 'logo';
}

export function detectReferenceModeAndKind(
  hasSketch: boolean,
  hasSubjectImage: boolean,
  placedRoles: Set<SketchReferenceRole>,
  activeReferenceRole?: SketchReferenceRole
): {
  referenceMode: 'none' | 'sketch' | 'identity' | 'composite';
  referenceKind?: ImageReferenceKind;
  includedRoles: SketchReferenceRole[];
} {
  const includedRoles = collectIncludedRoles(hasSketch, placedRoles);

  if (hasSketch && hasAnySubject(hasSubjectImage, activeReferenceRole)) {
    return { referenceMode: 'composite', referenceKind: 'composite', includedRoles };
  }
  if (hasSketch) {
    return { referenceMode: 'sketch', referenceKind: 'sketch', includedRoles };
  }

  const resolved = resolveReferenceKindWithoutSketch(hasSubjectImage, placedRoles, activeReferenceRole);
  return { referenceMode: resolved.mode, referenceKind: resolved.kind, includedRoles };
}

export function buildCompositePreview(
  canvasAspectRatio: SketchCanvasAspectRatio,
  providerAspectRatio: FlowSupportedAspectRatio,
  includedRoles: SketchReferenceRole[],
  excludedGuidesCount: number,
  diagnostics: SketchReferenceDiagnostic[],
  dataUrl?: string
): SketchCompositePreview {
  const preset = ASPECT_RATIO_PRESETS[providerAspectRatio] || ASPECT_RATIO_PRESETS['1:1'];

  return {
    width: preset.width,
    height: preset.height,
    canvasAspectRatio,
    providerAspectRatio,
    dataUrl,
    includedReferencesCount: includedRoles.length,
    includedRoles,
    excludedGuidesCount,
    diagnostics,
    createdAt: new Date().toISOString(),
  };
}

function collectAspectDiagnostics(
  canvasAspectRatio: SketchCanvasAspectRatio,
  providerAspectRatio: FlowSupportedAspectRatio,
  diagnostics: SketchReferenceDiagnostic[]
): void {
  if (canvasAspectRatio !== providerAspectRatio) {
    diagnostics.push({
      code: 'ASPECT_RATIO_ADAPTED',
      severity: 'info',
      message: `A proporção da prancheta (${canvasAspectRatio}) foi adaptada para ${providerAspectRatio} no envio ao FlowProvider.`,
    });
  }
}

function collectStructuralDiagnostics(
  referenceMode: string,
  guideCount: number,
  placedCount: number,
  hasActiveRef: boolean,
  diagnostics: SketchReferenceDiagnostic[]
): void {
  if (referenceMode === 'composite') {
    diagnostics.push({
      code: 'COMPOSITE_UNIFICATION',
      severity: 'info',
      message: 'Esboço de composição espacial e elemento(s) visual(is) foram unificados em uma única referência composta para compatibilidade com o Flow.',
    });
    if (placedCount > 1) {
      diagnostics.push({
        code: 'MULTIPLE_SUBJECTS_COMPOSITED',
        severity: 'info',
        message: `${placedCount} elementos visuais posicionados foram combinados na prancheta para envio em imagem única ao Flow.`,
      });
    }
    if (hasActiveRef && placedCount > 0) {
      diagnostics.push({
        code: 'REFERENCE_SUPERSEDED_BY_COMPOSITE',
        severity: 'info',
        message: 'O provedor aceita uma única referência visual. A composição unificada da prancheta é enviada como referência principal.',
      });
    }
  }
  if (guideCount > 0) {
    diagnostics.push({
      code: 'GUIDES_EXCLUDED',
      severity: 'info',
      message: `${guideCount} anotação(ões)/guia(s) de layout foram isoladas e excluídas da referência visual enviada ao Flow.`,
    });
  }
}

function resolveActiveReference(
  project: SketchProjectData,
  placedImages: ImageLayer[],
  overrideDataUrl?: string
): { activeAtt?: SketchAttachment; preparedRefImage?: string } {
  const activeAtt = project.activeReferenceId
    ? project.attachments.find((a) => a.id === project.activeReferenceId)
    : undefined;
  const fallbackPlacedImage = placedImages.length > 0 ? placedImages[0].imageUrl : undefined;
  const preparedRefImage = overrideDataUrl || activeAtt?.dataUrl || fallbackPlacedImage || undefined;
  return { activeAtt, preparedRefImage };
}

export interface PrepareSketchCompositeOptions {
  referenceDataUrlOverride?: string;
  quantity?: 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4';
  model?: string;
}

function resolveCanvasRatio(project: SketchProjectData): SketchCanvasAspectRatio {
  if (project.canvasAspectRatio) return project.canvasAspectRatio;
  if (project.aspectRatio) return project.aspectRatio;
  return '1:1';
}

function resolveProviderRatio(project: SketchProjectData, canvasRatio: SketchCanvasAspectRatio): FlowSupportedAspectRatio {
  const dims = project.canvasDimensions;
  return resolveProviderAspectRatio(canvasRatio, dims ? dims.width : undefined, dims ? dims.height : undefined);
}

function buildProviderOptions(
  referenceMode: string,
  referenceKind: ImageReferenceKind | undefined,
  providerAspectRatio: FlowSupportedAspectRatio,
  preparedRefImage: string | undefined,
  options?: PrepareSketchCompositeOptions
) {
  const isRef = referenceMode !== 'none';
  const qty = options && options.quantity ? options.quantity : 1;
  const mdl = options ? options.model : undefined;
  return {
    operation: isRef ? ('reference' as const) : ('simple' as const),
    referenceKind,
    aspectRatio: providerAspectRatio,
    quantity: qty,
    model: mdl,
    referenceImage: preparedRefImage,
  };
}

function emptyCopy(): SketchCopyData {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    headline: '',
    subheadline: '',
    cta: '',
    badge: '',
  };
}

/**
 * The simple flow (a typed idea plus optional references) never collects copy
 * fields. Any headline or CTA found on such a project is residue from an older
 * campaign and must not reach the image prompt or reserve empty typography
 * areas.
 */
function resolveSimpleFlowCopy(project: SketchProjectData): {
  copy: SketchCopyData;
  strategy: TextRenderingStrategy;
  requestedWording?: string;
  missingWording: boolean;
} {
  const wording = extractRequestedWording(project.prompt);
  if (wording) {
    return { copy: { ...emptyCopy(), headline: wording }, strategy: 'baked', requestedWording: wording, missingWording: false };
  }
  return {
    copy: emptyCopy(),
    strategy: 'layer',
    missingWording: requestsVisibleText(project.prompt),
  };
}

function resolveEffectiveCopy(project: SketchProjectData): {
  copy: SketchCopyData;
  layers: SketchLayer[];
  strategy: TextRenderingStrategy;
  diagnostics: SketchReferenceDiagnostic[];
} {
  if (!project.currentOrder) {
    return {
      copy: project.copy,
      layers: project.layers,
      strategy: project.textRenderingStrategy || 'layer',
      diagnostics: [],
    };
  }

  const resolved = resolveSimpleFlowCopy(project);
  const diagnostics: SketchReferenceDiagnostic[] = [];
  if (resolved.missingWording) {
    diagnostics.push({
      code: 'TEXT_WORDING_REQUIRED',
      severity: 'warning',
      message:
        'A ideia pede texto ou chamada de ação, mas nenhuma frase exata foi informada. A arte foi gerada com espaço limpo; escreva a frase entre aspas para ela ser renderizada na imagem.',
    });
  }

  return {
    copy: resolved.copy,
    layers: project.layers.filter((layer) => layer.type !== 'text'),
    strategy: resolved.strategy,
    diagnostics,
  };
}

/**
 * Roles chosen by the user in the simple flow, in the order they were selected.
 */
function resolveSubjectRoles(project: SketchProjectData): CreativeSubjectRole[] {
  const references = project.currentOrder?.selectedReferences || [];
  const roles: CreativeSubjectRole[] = [];
  for (const reference of references) {
    const attachment = project.attachments.find((item) => item.id === reference.attachmentId);
    const role = (reference.role || attachment?.role) as SketchReferenceRole | undefined;
    if (!role) continue;
    roles.push({ role, label: attachment?.name });
  }
  return roles;
}

const PRODUCT_INTENT_REGEX = /\b(produto|produtos|product|vendendo|vender|venda|selling|compre|compra|lan[cç]amento)\b/i;

/**
 * When the idea advertises a product but the attached references only show the
 * person, the generator cannot show the product without inventing it. Warning
 * here is cheaper than a finished ad with the product missing.
 */
function checkProductReferenceCoverage(
  project: SketchProjectData,
  subjectRoles: CreativeSubjectRole[]
): SketchReferenceDiagnostic | null {
  if (!project.currentOrder || subjectRoles.length === 0) return null;
  if (subjectRoles.some((subject) => subject.role === 'product' || subject.role === 'logo')) return null;
  if (!PRODUCT_INTENT_REGEX.test(project.prompt || '')) return null;
  return {
    code: 'PRODUCT_REFERENCE_MISSING',
    severity: 'warning',
    message:
      'A ideia vende um produto, mas nenhum anexo está marcado como Produto. Anexe a foto do produto (ou marque a imagem certa como Produto) para ela aparecer na arte; sem referência o gerador não inventa o produto.',
  };
}

/**
 * In the simple flow the layout is a rough pencil sketch over pasted photos, so
 * the generator must treat it as guidance instead of reproducing it. Older
 * projects carry a stored "follow" from the retired canvas flow.
 */
function resolveCompositionIntent(
  project: SketchProjectData,
  hasSketch: boolean,
  selectedReferenceCount: number
): CompositionIntent {
  if (!project.currentOrder) return project.compositionIntent || 'follow';
  return hasSketch && selectedReferenceCount > 0 ? 'explore' : 'follow';
}

/**
 * The provider receives a single assembled board whenever photos and sketch
 * have to travel together, even before the layered-reference detection runs.
 */
function willUseCompositeReference(
  referenceMode: string,
  hasSketch: boolean,
  selectedReferenceCount: number
): boolean {
  return referenceMode === 'composite' || (hasSketch && selectedReferenceCount > 0) || selectedReferenceCount > 1;
}

function assembleCreativeCompilation(
  project: SketchProjectData,
  hasSketch: boolean,
  referenceMode: string,
  selectedReferenceCount: number,
  diagnostics: SketchReferenceDiagnostic[]
): {
  compositionIntent: 'follow' | 'explore';
  textRenderingStrategy: 'layer' | 'baked';
  compiledPrompt: string;
  creativeCompilation: CreativeGenerationCompiledRequest;
} {
  const effective = resolveEffectiveCopy(project);
  diagnostics.push(...effective.diagnostics);

  const compositionIntent = resolveCompositionIntent(project, hasSketch, selectedReferenceCount);
  const textRenderingStrategy = effective.strategy;
  const hasCompositeReference = willUseCompositeReference(referenceMode, hasSketch, selectedReferenceCount);
  const subjectRoles = resolveSubjectRoles(project);
  const missingProductReference = checkProductReferenceCoverage(project, subjectRoles);
  if (missingProductReference) diagnostics.push(missingProductReference);

  const compiledPrompt = compileCreativeGenerationPrompt({
    prompt: project.prompt,
    briefing: project.briefing,
    copy: effective.copy,
    layers: effective.layers,
    attachments: project.attachments,
    compositionIntent,
    textRenderingStrategy,
    hasSketch,
    hasCompositeReference,
    subjectCount: selectedReferenceCount > 0 ? selectedReferenceCount : undefined,
    subjectRoles,
  });

  const promptIssues = validateCreativePrompt(compiledPrompt, textRenderingStrategy, {
    maxWords: SKETCH_PROMPT_MAX_WORDS,
  });
  for (const issue of promptIssues) {
    diagnostics.push({
      code: 'PROMPT_QUALITY_ISSUE',
      severity: 'warning',
      message: issue,
    });
  }

  const creativeCompilation: CreativeGenerationCompiledRequest = {
    briefing: project.briefing || { productDescription: '' },
    copy: effective.copy,
    compositionIntent,
    textRenderingStrategy,
    reservedCopyZones: extractCopyZones(effective.layers),
    subjectPlacements: extractSubjectPlacements(project.layers, project.attachments),
    compositionGuides: extractCompositionGuides(project.layers),
    compiledPrompt,
    validationIssues: promptIssues,
  };

  return { compositionIntent, textRenderingStrategy, compiledPrompt, creativeCompilation };
}

export function resolveSelectedReferenceIds(project: SketchProjectData): Set<string> {
  return new Set(
    (project.currentOrder?.selectedReferences || [])
      .map((reference) => reference.attachmentId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
}

function pushDiagnosticOnce(
  diagnostics: SketchReferenceDiagnostic[],
  code: string,
  issues: string[]
): void {
  for (const issue of issues) {
    if (diagnostics.some((entry) => entry.message === issue)) continue;
    diagnostics.push({ code, severity: 'warning', message: issue });
  }
}

export function prepareSketchCompositeReference(
  project: SketchProjectData,
  options?: PrepareSketchCompositeOptions
): SketchGenerationRequest {
  const canvasAspectRatio = resolveCanvasRatio(project);
  const providerAspectRatio = resolveProviderRatio(project, canvasAspectRatio);

  const diagnostics: SketchReferenceDiagnostic[] = [];
  collectAspectDiagnostics(canvasAspectRatio, providerAspectRatio, diagnostics);

  const sketchInfo = detectSketchPresence(project.layers, project.useSketchAsReference !== false);
  const placedInfo = detectPlacedImages(project.layers, project.attachments);
  const refOverride = options ? options.referenceDataUrlOverride : undefined;
  const { activeAtt, preparedRefImage } = resolveActiveReference(
    project,
    placedInfo.placedImages,
    refOverride
  );
  const activeRefRole = activeAtt ? (activeAtt.role as SketchReferenceRole) : undefined;

  const unplacedDiag = checkUnplacedAttachments(
    project.attachments,
    placedInfo.placedAttachmentIds,
    project.activeReferenceId,
    resolveSelectedReferenceIds(project)
  );
  diagnostics.push(...unplacedDiag);

  const { referenceMode, referenceKind, includedRoles } = detectReferenceModeAndKind(
    sketchInfo.hasSketch,
    placedInfo.hasSubjectImage,
    placedInfo.roles,
    activeRefRole
  );

  collectStructuralDiagnostics(
    referenceMode,
    sketchInfo.guideCount,
    placedInfo.placedImages.length,
    Boolean(activeAtt),
    diagnostics
  );

  const creative = assembleCreativeCompilation(
    project,
    sketchInfo.hasSketch,
    referenceMode,
    resolveSelectedReferenceIds(project).size || placedInfo.placedImages.length,
    diagnostics
  );

  const preparedPrompt = prepareFlowImagePrompt({
    prompt: creative.compiledPrompt,
    operation: referenceMode !== 'none' ? 'reference' : 'simple',
    aspectRatio: providerAspectRatio,
    referenceKind,
    // The Sketch prompt is composed and curated by this pipeline, so it gets a
    // larger budget than LLM text. Truncating it here used to delete the user's
    // creative direction; validateCreativePrompt still warns above 320 words.
    maxCoreWords: 560,
    maxFinalWords: 600,
  });

  const finalPromptIssues = validateCreativePrompt(
    preparedPrompt,
    creative.textRenderingStrategy,
    {
      hasSketch: sketchInfo.hasSketch,
      briefing: project.briefing,
      copy: creative.creativeCompilation.copy,
      maxWords: SKETCH_PROMPT_MAX_WORDS,
    }
  );

  pushDiagnosticOnce(diagnostics, 'PROMPT_QUALITY_ISSUE', finalPromptIssues);
  pushDiagnosticOnce(diagnostics, 'PROMPT_IDEA_NOT_PRESERVED', checkIdeaPreservation(preparedPrompt, project.prompt));

  creative.creativeCompilation.compiledPrompt = preparedPrompt;
  creative.creativeCompilation.validationIssues = finalPromptIssues;

  const compositePreview = buildCompositePreview(
    canvasAspectRatio,
    providerAspectRatio,
    includedRoles,
    sketchInfo.guideCount,
    diagnostics,
    preparedRefImage
  );

  const schemaVer = project.schemaVersion ? project.schemaVersion : 1;

  return {
    id: `req-${Date.now()}`,
    projectId: project.id,
    schemaVersion: schemaVer,
    prompt: project.prompt,
    preparedPrompt,
    canvasAspectRatio,
    providerAspectRatio,
    referenceMode,
    referenceKind,
    compositionIntent: creative.compositionIntent,
    textRenderingStrategy: creative.textRenderingStrategy,
    preparedReferenceImage: preparedRefImage,
    compositePreview,
    creativeCompilation: creative.creativeCompilation,
    diagnostics,
    providerOptions: buildProviderOptions(
      referenceMode,
      referenceKind,
      providerAspectRatio,
      preparedRefImage,
      options
    ),
    createdAt: new Date().toISOString(),
  };
}
