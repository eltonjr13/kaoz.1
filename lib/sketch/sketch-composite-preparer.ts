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
  type ImageLayer,
  type SketchDrawingLayer,
  resolveProviderAspectRatio,
  ASPECT_RATIO_PRESETS,
} from '../../types/sketch';
import { prepareFlowImagePrompt } from '../ai/image-prompt-engineering';
import type { ImageReferenceKind } from '@/src/providers/flow/ImageGenerationContract';

interface SketchAnalysis {
  hasSketch: boolean;
  pathCount: number;
  guideCount: number;
  sketchLayer?: SketchDrawingLayer;
}

export function detectSketchPresence(layers: SketchLayer[]): SketchAnalysis {
  let hasSketch = false;
  let pathCount = 0;
  let guideCount = 0;
  let sketchLayer: SketchDrawingLayer | undefined;

  for (const layer of layers) {
    if (layer.type === 'sketch' && layer.visible) {
      sketchLayer = layer;
      for (const path of layer.paths) {
        if (path.isGuide) {
          guideCount++;
        } else {
          pathCount++;
          hasSketch = true;
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
}

export function detectPlacedImages(layers: SketchLayer[]): PlacedImagesAnalysis {
  const placedImages: ImageLayer[] = [];
  const placedAttachmentIds = new Set<string>();
  const roles = new Set<SketchReferenceRole>();
  let hasProductImage = false;

  for (const layer of layers) {
    if (layer.type === 'image' && layer.visible && !layer.isGuide && layer.imageUrl) {
      placedImages.push(layer);
      if (layer.attachmentId) {
        placedAttachmentIds.add(layer.attachmentId);
      }
      const r = layer.role as SketchReferenceRole | undefined;
      if (r) {
        roles.add(r);
        if (r === 'product') hasProductImage = true;
      }
    }
  }

  return { placedImages, placedAttachmentIds, roles, hasProductImage };
}

export function checkUnplacedAttachments(
  attachments: SketchAttachment[],
  placedAttachmentIds: Set<string>,
  activeReferenceId?: string
): SketchReferenceDiagnostic[] {
  const diagnostics: SketchReferenceDiagnostic[] = [];

  for (const att of attachments) {
    const isPlaced = placedAttachmentIds.has(att.id);
    const isActiveRef = activeReferenceId === att.id;

    if (!isPlaced && !isActiveRef) {
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

export function detectReferenceModeAndKind(
  hasSketch: boolean,
  hasProductImage: boolean,
  placedRoles: Set<SketchReferenceRole>,
  activeReferenceRole?: SketchReferenceRole
): {
  referenceMode: 'none' | 'sketch' | 'identity' | 'composite';
  referenceKind?: ImageReferenceKind;
  includedRoles: SketchReferenceRole[];
} {
  const includedRoles: SketchReferenceRole[] = [];
  if (hasSketch) includedRoles.push('composition');
  for (const role of placedRoles) {
    if (!includedRoles.includes(role)) includedRoles.push(role);
  }

  if (hasSketch && (hasProductImage || activeReferenceRole === 'product')) {
    return { referenceMode: 'composite', referenceKind: 'composite', includedRoles };
  }

  if (hasSketch) {
    return { referenceMode: 'sketch', referenceKind: 'sketch', includedRoles };
  }

  if (hasProductImage || activeReferenceRole === 'product') {
    return { referenceMode: 'identity', referenceKind: 'identity', includedRoles };
  }

  if (placedRoles.has('style') || activeReferenceRole === 'style') {
    return { referenceMode: 'identity', referenceKind: 'style', includedRoles };
  }

  if (placedRoles.size > 0 || activeReferenceRole) {
    return { referenceMode: 'identity', referenceKind: 'identity', includedRoles };
  }

  return { referenceMode: 'none', referenceKind: undefined, includedRoles };
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

export interface PrepareSketchCompositeOptions {
  referenceDataUrlOverride?: string;
  quantity?: 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4';
  model?: string;
}

export function prepareSketchCompositeReference(
  project: SketchProjectData,
  options?: PrepareSketchCompositeOptions
): SketchGenerationRequest {
  const canvasAspectRatio = project.canvasAspectRatio || project.aspectRatio || '1:1';
  const providerAspectRatio = resolveProviderAspectRatio(
    canvasAspectRatio,
    project.canvasDimensions?.width,
    project.canvasDimensions?.height
  );

  const diagnostics: SketchReferenceDiagnostic[] = [];

  if (canvasAspectRatio !== providerAspectRatio) {
    diagnostics.push({
      code: 'ASPECT_RATIO_ADAPTED',
      severity: 'info',
      message: `A proporção da prancheta (${canvasAspectRatio}) foi adaptada para ${providerAspectRatio} no envio ao FlowProvider.`,
    });
  }

  const sketchInfo = detectSketchPresence(project.layers);
  const placedInfo = detectPlacedImages(project.layers);

  const activeAtt = project.activeReferenceId
    ? project.attachments.find((a) => a.id === project.activeReferenceId)
    : undefined;
  const activeRefRole = activeAtt?.role as SketchReferenceRole | undefined;

  const unplacedDiag = checkUnplacedAttachments(
    project.attachments,
    placedInfo.placedAttachmentIds,
    project.activeReferenceId
  );
  diagnostics.push(...unplacedDiag);

  const { referenceMode, referenceKind, includedRoles } = detectReferenceModeAndKind(
    sketchInfo.hasSketch,
    placedInfo.hasProductImage,
    placedInfo.roles,
    activeRefRole
  );

  if (referenceMode === 'composite') {
    diagnostics.push({
      code: 'COMPOSITE_UNIFICATION',
      severity: 'info',
      message: 'Esboço de composição espacial e imagem de produto foram unificados em uma única referência composta para compatibilidade com o Flow.',
    });
  }

  if (sketchInfo.guideCount > 0) {
    diagnostics.push({
      code: 'GUIDES_EXCLUDED',
      severity: 'info',
      message: `${sketchInfo.guideCount} anotação(ões)/guia(s) de layout foram isoladas e excluídas da referência visual enviada ao Flow.`,
    });
  }

  const preparedPrompt = prepareFlowImagePrompt({
    prompt: project.prompt,
    operation: referenceMode !== 'none' ? 'reference' : 'simple',
    aspectRatio: providerAspectRatio,
    referenceKind,
  });

  const preparedReferenceImage = options?.referenceDataUrlOverride || activeAtt?.dataUrl || undefined;

  const compositePreview = buildCompositePreview(
    canvasAspectRatio,
    providerAspectRatio,
    includedRoles,
    sketchInfo.guideCount,
    diagnostics,
    preparedReferenceImage
  );

  return {
    id: `req-${Date.now()}`,
    projectId: project.id,
    schemaVersion: project.schemaVersion || 1,
    prompt: project.prompt,
    preparedPrompt,
    canvasAspectRatio,
    providerAspectRatio,
    referenceMode,
    referenceKind,
    preparedReferenceImage,
    compositePreview,
    diagnostics,
    providerOptions: {
      operation: referenceMode !== 'none' ? 'reference' : 'simple',
      referenceKind,
      aspectRatio: providerAspectRatio,
      quantity: options?.quantity || 1,
      model: options?.model,
      referenceImage: preparedReferenceImage,
    },
    createdAt: new Date().toISOString(),
  };
}
