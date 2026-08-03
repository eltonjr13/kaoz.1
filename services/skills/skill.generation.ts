export type SkillGenerationQueryOptions = {
  jsonMode: true;
  maxOutputTokens: number;
};

type SkillGenerationQuery = (
  prompt: string,
  options: SkillGenerationQueryOptions,
) => Promise<string | null>;

type SkillGenerationValidator = (value: Record<string, unknown>) => void;

const QUERY_OPTIONS: SkillGenerationQueryOptions = {
  jsonMode: true,
  maxOutputTokens: 16_000,
};

export function extractSkillGenerationJson(text: string): Record<string, unknown> {
  const clean = text.replace(/^```json\s*|\s*```$/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("O modelo não retornou uma resposta estruturada.");
  return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
}

export async function querySkillGenerationJson(
  prompt: string,
  query: SkillGenerationQuery,
  validate?: SkillGenerationValidator,
): Promise<Record<string, unknown>> {
  let structuralError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const correction = attempt === 0
      ? ""
      : "\n\n[CORREÇÃO OBRIGATÓRIA]\nA resposta anterior não era JSON válido. Responda novamente com um único objeto JSON completo, sem Markdown, comentários ou texto externo.";
    const output = await query(`${prompt}${correction}`, QUERY_OPTIONS);
    if (!output) {
      throw new Error("O provedor Browser não está disponível para este criador. Selecione um provedor CLI ou API em Agente LLM.");
    }

    try {
      const parsed = extractSkillGenerationJson(output);
      validate?.(parsed);
      return parsed;
    } catch (error) {
      structuralError = error;
    }
  }

  throw structuralError instanceof Error
    ? structuralError
    : new Error("O modelo não retornou uma resposta estruturada.");
}
