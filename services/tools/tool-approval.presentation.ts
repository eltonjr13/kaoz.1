import {
  sanitizePublicErrorMessage,
  sanitizeSensitiveValue,
} from "../orchestrator/orchestrator.policy.ts";
import type { ToolResult } from "./tool.types.ts";

export async function presentApprovedMcpResult(
  prompt: string,
  result: ToolResult,
  executor: (currentPrompt: string) => Promise<string>,
): Promise<string> {
  const serializedResult = serializeSafely(sanitizeSensitiveValue(result));
  const presentationPrompt =
    `${prompt}\n\n[RESULTADO DA FERRAMENTA MCP APROVADA]\n` +
    `${serializedResult}\n\n` +
    "A ação acima já foi executada uma única vez. Responda ao usuário " +
    "com o resultado observado e não repita a mesma chamada.";
  try {
    return await executor(presentationPrompt);
  } catch (error) {
    const safeResult = serializedResult.slice(0, 4_000);
    const safeError = sanitizePublicErrorMessage(error);
    return JSON.stringify({
      message:
        "A chamada MCP já foi executada uma única vez, mas não foi possível " +
        `gerar o resumo final. Resultado observado: ${safeResult}. ` +
        `Falha de apresentação: ${safeError}`,
      action: null,
    });
  }
}

export function approvedImageArtifactResponse(result: ToolResult): string {
  const artifacts = result.artifacts?.filter(
    (artifact) => artifact.type === "image" || artifact.mimeType?.startsWith("image/"),
  ) || [];
  return JSON.stringify({
    message: "Capturei o print solicitado. A imagem está anexada abaixo para visualizar ou baixar.",
    action: null,
    artifacts,
  });
}

function serializeSafely(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[resultado não serializável]";
  }
}
