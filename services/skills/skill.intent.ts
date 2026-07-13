export function normalizeSkillIntent(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function isBuildSkillsIntent(value: string): boolean {
  const normalized = normalizeSkillIntent(value);
  if (/^\s*\/build-skills(?:\s|$)/.test(normalized)) return true;
  return /\b(criar|crie|montar|monte|gerar|gere|projetar|projete|revisar|revise|atualizar|atualize)\b/.test(normalized)
    && /\bskills?\b/.test(normalized);
}
