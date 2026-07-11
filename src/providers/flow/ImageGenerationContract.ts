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
