import type { SketchJobSnapshot } from '../../types/sketch.ts';

export interface SketchJobWarning {
  code: string;
  message: string;
}

/**
 * Only diagnostics the person using the studio can actually act on. Internal
 * quality notes (prompt length, aspect adaptation) stay in the job file.
 */
const ACTIONABLE_DIAGNOSTIC_CODES = new Set([
  'TEXT_WORDING_REQUIRED',
  'REFERENCE_DROPPED',
  'REFERENCE_UNAVAILABLE',
  'REFERENCE_INVALID',
  'REFERENCE_UNREADABLE',
  'UNPLACED_ATTACHMENT',
  'SKETCH_RENDER_FAILED',
  'PROMPT_IDEA_NOT_PRESERVED',
  'PRODUCT_REFERENCE_MISSING',
]);

export function collectJobWarnings(
  snapshot?: Pick<SketchJobSnapshot, 'diagnostics'> | null
): SketchJobWarning[] {
  const diagnostics = snapshot?.diagnostics || [];
  const seen = new Set<string>();
  const warnings: SketchJobWarning[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'info') continue;
    if (!ACTIONABLE_DIAGNOSTIC_CODES.has(diagnostic.code)) continue;
    if (seen.has(diagnostic.message)) continue;
    seen.add(diagnostic.message);
    warnings.push({ code: diagnostic.code, message: diagnostic.message });
  }

  return warnings;
}
