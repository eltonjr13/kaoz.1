import type { SketchReferenceRole } from '../../types/sketch.ts';

const LOGO_NAME_HINT = /\b(logo|marca|brand)\b/i;

/**
 * Every attached photo is a subject to preserve until the person says
 * otherwise. The previous default marked the second file as "style", which
 * tells the generator to borrow only palette and light — so a real product
 * photo attached after the person ended up ignored in the art.
 */
export function resolveDefaultAttachmentRole(name?: string): SketchReferenceRole {
  if (name && LOGO_NAME_HINT.test(name)) return 'logo';
  return 'product';
}
