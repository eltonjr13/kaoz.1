export const ANTIGRAVITY_INLINE_PROMPT_BUDGET = 27_500;

export function compactInlinePrompt(prompt: string, maximum: number, latestUserPrompt = ""): string {
  if (prompt.length <= maximum) return prompt;
  const latest = latestUserPrompt.trim().slice(-4_000);
  const omission = "\n\n[CONTEXTO INTERMEDIARIO COMPACTADO PARA O LIMITE DO PROVEDOR]\n\n";
  const latestSection = latest ? `[ULTIMO PEDIDO DO USUARIO - PRESERVAR INTEGRALMENTE]:\n${latest}\n\n` : "";
  const available = Math.max(0, maximum - omission.length - latestSection.length);
  const headLength = Math.floor(available * 0.7);
  const tailLength = available - headLength;
  return `${prompt.slice(0, headLength)}${omission}${latestSection}${prompt.slice(-tailLength)}`.slice(0, maximum);
}

export function compactToolSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return { type: "object" };
  const input = schema as Record<string, unknown>;
  const result: Record<string, unknown> = { type: typeof input.type === "string" ? input.type : "object" };
  if (Array.isArray(input.required)) result.required = input.required;
  if (typeof input.additionalProperties === "boolean") result.additionalProperties = input.additionalProperties;
  if (input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)) {
    result.properties = Object.fromEntries(Object.entries(input.properties as Record<string, unknown>).map(([name, value]) => {
      const property = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const compact: Record<string, unknown> = { type: typeof property.type === "string" ? property.type : "string" };
      if (Array.isArray(property.enum)) compact.enum = property.enum;
      if (property.items && typeof property.items === "object") compact.items = compactToolSchema(property.items);
      return [name, compact];
    }));
  }
  return result;
}
