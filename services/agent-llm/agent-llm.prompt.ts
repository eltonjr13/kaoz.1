export const ANTIGRAVITY_INLINE_PROMPT_BUDGET = 27_500;
const PUBLISH_VERB_PATTERN = /\b(publicar|publique|publica|postar|poste|posta|enviar|envie|envia|mandar|mande|manda)\b/;

export function connectorPublishProvider(text: string): "discord" | "bluesky" | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(nao|não|sem)\s+(?:quero\s+que\s+)?(?:publicar|publique|publica|postar|poste|posta|enviar|envie|envia|mandar|mande|manda)\b/.test(normalized)) return null;
  if (!PUBLISH_VERB_PATTERN.test(normalized)) return null;
  if (/\bdiscord\b/.test(normalized)) return "discord";
  if (/\b(bluesky|blue sky)\b/.test(normalized)) return "bluesky";
  return null;
}

export function missingConnectorToolCallInstruction(provider: "discord" | "bluesky", previousOutput: string): string {
  return `

[CORRECAO OBRIGATORIA - PUBLICACAO NAO EXECUTADA]
O usuario pediu explicitamente para enviar/publicar no ${provider}. Sua resposta anterior nao chamou a ferramenta e, portanto, nada foi publicado.
Resposta anterior: ${JSON.stringify(previousOutput.slice(0, 2_000))}
Agora responda SOMENTE com <TOOL_CALL>{"toolId":"social:${provider}:publish","args":{"text":"CONTEUDO FINAL COMPLETO"}}</TOOL_CALL>.
Em args.text, escreva o conteudo concreto solicitado pelo usuario. Nao escreva promessa, introducao, explicacao, "vou enviar" ou texto fora de TOOL_CALL.
`;
}

export function connectorToolResultResponse(provider: "discord" | "bluesky", result: unknown): string {
  const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  const output = record.output && typeof record.output === "object" && !Array.isArray(record.output)
    ? record.output as Record<string, unknown>
    : record;
  const remoteId = typeof output.remoteId === "string" ? output.remoteId : "";
  const url = typeof output.url === "string" ? output.url : "";
  const destination = provider === "discord" ? "Discord" : "Bluesky";
  const details = url ? ` [Abrir publicação](${url})` : remoteId ? ` ID: ${remoteId}.` : "";
  return JSON.stringify({ message: `Publicado no ${destination} com sucesso.${details}`, action: null });
}

export function connectorToolErrorResponse(provider: "discord" | "bluesky", error: unknown): string {
  const destination = provider === "discord" ? "Discord" : "Bluesky";
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify({ message: `Não foi possível publicar no ${destination}: ${message}. Nada foi enviado.`, action: null });
}

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
