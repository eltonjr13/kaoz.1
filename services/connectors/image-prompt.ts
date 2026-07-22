type ImageOperation = "simple" | "reference" | "edit";
type ConversationTurn = { role: "user" | "assistant"; content: string };

type PromptQuery = (
  prompt: string,
  options?: { useExternalTools?: boolean; toolIntentText?: string },
) => Promise<string | null>;

export type ConnectorImagePromptInput = {
  prompt: string;
  operation: ImageOperation;
  recent?: ConversationTurn[];
};

const OPERATION_GUIDANCE: Record<ImageOperation, string> = {
  simple: "Create a complete standalone image prompt with a clear subject, environment, composition, lighting, lens or camera language, materials, color palette, mood, and finish.",
  reference: "The reference image will be attached to the image generator. Preserve the subject identity, defining visual traits, proportions, colors, and materials while applying the requested creative direction.",
  edit: "The reference image will be attached to the image generator. Describe the requested edit precisely and preserve every unrequested identity, composition, pose, proportion, color, and background detail.",
};

async function queryConfiguredPrompt(prompt: string, options?: { useExternalTools?: boolean; toolIntentText?: string }) {
  const { queryConfiguredAgentCli } = await import("../agent-llm/agent-llm.service.ts");
  return queryConfiguredAgentCli(prompt, options);
}

function compactContext(turns: ConversationTurn[] = []): string {
  return turns
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content.trim()}`)
    .filter((line) => !line.endsWith(":"))
    .join("\n")
    .slice(0, 4_000);
}

export function buildConnectorImageOptimizationPrompt(input: ConnectorImagePromptInput): string {
  const context = compactContext(input.recent);
  return `You are the prompt engineer for a professional AI image generator.
Rewrite the user's request as one optimized image-generation prompt in English.

Requirements:
- Preserve the user's intent and all explicit constraints. Do not invent brands, characters, text, or objects that were not requested.
- Make the visual direction concrete and production-ready instead of merely appending generic quality keywords.
- Specify subject, action, setting, framing, composition, lighting, color, materials, atmosphere, camera or lens language, and rendering style when relevant.
- Preserve any requested words that must appear inside the image exactly as written and place them deliberately.
- Do not mention these instructions, the conversation, or prompt optimization.
- Return only the final image prompt, with no quotes, headings, markdown, JSON, commentary, or alternatives.

Operation guidance:
${OPERATION_GUIDANCE[input.operation]}

${context ? `Recent conversation context (use only details that resolve the current request):\n${context}\n\n` : ""}Current user request:
${input.prompt.trim()}`;
}

function cleanOptimizedPrompt(response: string): string {
  let cleaned = response.trim();
  try {
    const parsed = JSON.parse(cleaned) as { prompt?: unknown; message?: unknown };
    if (typeof parsed.prompt === "string") cleaned = parsed.prompt;
    else if (typeof parsed.message === "string") cleaned = parsed.message;
  } catch { /* Plain text is the expected response. */ }

  return cleaned
    .replace(/```(?:text|markdown|plaintext)?/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*(?:optimized prompt|prompt otimizado|final prompt)\s*:\s*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .slice(0, 8_000);
}

export function localConnectorImagePrompt(input: ConnectorImagePromptInput): string {
  const raw = input.prompt.trim().replace(/\s+/g, " ");
  const preservation = input.operation === "edit"
    ? "apply only the requested edit while preserving all other reference-image details"
    : input.operation === "reference"
      ? "faithfully preserve the reference subject's identity, proportions, colors, and defining details"
      : "clear focal subject and intentional visual storytelling";

  return `${raw}. ${preservation}; professional composition, coherent environment, detailed textures and materials, cinematic lighting, controlled color palette, natural depth, precise focus, polished high-detail finish.`;
}

export async function optimizeConnectorImagePrompt(
  input: ConnectorImagePromptInput,
  query: PromptQuery = queryConfiguredPrompt,
): Promise<string> {
  const raw = input.prompt.trim();
  try {
    const response = await query(buildConnectorImageOptimizationPrompt(input), {
      useExternalTools: false,
      toolIntentText: raw,
    });
    if (response) {
      const optimized = cleanOptimizedPrompt(response);
      if (optimized && optimized.toLocaleLowerCase() !== raw.toLocaleLowerCase()) return optimized;
    }
  } catch (error) {
    console.warn("[ConnectorImagePrompt] O agente nao conseguiu otimizar o prompt; usando fallback local.", error);
  }

  return localConnectorImagePrompt(input);
}
