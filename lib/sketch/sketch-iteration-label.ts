/**
 * The result badge has to describe both the legacy canvas lineage types and the
 * simple flow change intents. The simple flow never filled `creativeResults`,
 * so every generation used to be labelled as the original version.
 */
export function describeIterationLabel(iterationType?: string, versionNumber?: number): string {
  const version = versionNumber ? `v${versionNumber}` : 'v1';
  switch (iterationType) {
    case 'new_concept':
      return `Outra ideia (${version})`;
    case 'text_adjustment':
      return `Ajuste de texto (${version})`;
    case 'refine_text':
      return `Ajuste pedido (${version})`;
    case 'visual_adjustment':
    case 'refine_visual':
      return `Ajuste visual (${version})`;
    case 'initial':
    default:
      return `Versão original (${version})`;
  }
}
