import { createHash } from "node:crypto";

const issuedAuthorizations = new WeakSet<object>();

export type McpCallAuthorization = Readonly<{
  kind: "mcp-central-execution";
  toolId: string;
  fingerprint: string;
}>;

/**
 * Internal capability issued only after ToolExecutionService validates and
 * consumes the user's human approval. Application code must never issue it.
 */
export function issueMcpCallAuthorization(
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): McpCallAuthorization {
  const authorization = Object.freeze({
    kind: "mcp-central-execution" as const,
    toolId,
    fingerprint: fingerprint(toolId, args),
  });
  issuedAuthorizations.add(authorization);
  return authorization;
}

export function consumeMcpCallAuthorization(
  authorization: unknown,
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): void {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    !issuedAuthorizations.has(authorization)
  ) {
    throw new Error(
      "Chamada MCP bloqueada: use o ToolExecutionService e uma aprovação humana válida.",
    );
  }
  issuedAuthorizations.delete(authorization);
  const candidate = authorization as Partial<McpCallAuthorization>;
  if (
    candidate.kind !== "mcp-central-execution" ||
    candidate.toolId !== toolId ||
    candidate.fingerprint !== fingerprint(toolId, args)
  ) {
    throw new Error(
      "A autorização MCP central não corresponde à ferramenta e aos argumentos.",
    );
  }
}

function fingerprint(
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): string {
  return createHash("sha256")
    .update(stableStringify({ toolId, args }))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
