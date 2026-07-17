export type ImageGenerationOperation = 'simple' | 'reference' | 'turnaround3d' | 'edit';

export type ImageReferenceSource =
  | 'none'
  | 'upload'
  | 'generated'
  | 'avatar'
  | 'selected-element';

export interface ImageReferenceDescriptor {
  source: ImageReferenceSource;
  imageData?: string | null;
  imagePath?: string | null;
  xpath?: string | null;
}

export interface ResolveImageOperationInput {
  imagePackageMode?: string | null;
  editSourceImagePath?: string | null;
  referenceImage?: string | null;
  referenceImagePath?: string | null;
  useAvatarVisualReference?: boolean;
}

export function resolveImageGenerationOperation(
  input: ResolveImageOperationInput
): ImageGenerationOperation {
  if (input.imagePackageMode === 'turnaround3d') return 'turnaround3d';
  if (input.editSourceImagePath) return 'edit';
  if (input.referenceImage || input.referenceImagePath || input.useAvatarVisualReference) return 'reference';
  return 'simple';
}

export function imageOperationRequiresReference(operation: ImageGenerationOperation): boolean {
  return operation === 'reference' || operation === 'edit';
}

export interface ResolveVisualReferenceInput {
  operation: ImageGenerationOperation;
  inputReferenceImage?: string;
  avatarReferenceImage?: string;
  useAvatarVisualReference?: boolean;
}

export function resolveVisualReference(input: ResolveVisualReferenceInput): string | undefined {
  if (input.operation === 'simple') return undefined;
  if (input.inputReferenceImage) return input.inputReferenceImage;
  if (input.useAvatarVisualReference) return input.avatarReferenceImage;
  return undefined;
}

export interface TurnaroundReferencePolicy {
  forceReferenceUpload: boolean;
  useExistingFlowReference: boolean;
}

/**
 * A turnaround package uploads a new reference only for its first generated
 * angle. Every later angle reuses the asset already stored in the same Flow
 * project. References that already came from that project never need upload.
 */
export function resolveTurnaroundReferencePolicy(
  viewIndex: number,
  referenceAlreadyInFlow = false
): TurnaroundReferencePolicy {
  const isFirstGeneratedView = viewIndex === 0;
  return {
    forceReferenceUpload: isFirstGeneratedView && !referenceAlreadyInFlow,
    useExistingFlowReference: referenceAlreadyInFlow || !isFirstGeneratedView,
  };
}

export type ReferenceAttachmentStrategy = 'select-existing' | 'upload';

export interface ResolveReferenceAttachmentStrategyInput {
  useExistingFlowReference: boolean;
  forceReferenceUpload: boolean;
}

/**
 * Distinguishes uploading a file from selecting an asset that was uploaded in
 * an earlier generation. This prevents one media-library copy per 3D angle.
 */
export function resolveReferenceAttachmentStrategy(
  input: ResolveReferenceAttachmentStrategyInput
): ReferenceAttachmentStrategy {
  if (input.useExistingFlowReference && !input.forceReferenceUpload) {
    // Each generate() call submits a new prompt. Even when the UI still shows
    // a nearby thumbnail, explicitly select the known project asset again so
    // every requested angle is conditioned by the same reference.
    return 'select-existing';
  }
  return 'upload';
}
