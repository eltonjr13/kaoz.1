import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import {
  redactSecrets,
  sanitizeSensitiveValue,
} from "../orchestrator/orchestrator.policy.ts";
import type { KaozTool, ToolResult } from "./tool.types.ts";
import { assertToolArguments } from "./tool.validation.ts";
import { isPlaywrightMcpToolId } from "../agent-llm/agent-llm.prompt.ts";

const APPROVAL_TTL_MS = 15 * 60_000;
const CONSUMED_RETENTION_MS = 60 * 60_000;
const TOKEN_PATTERN = /^\s*aprovar\s+([A-F0-9]{12})\s*$/i;
const issuedMcpApprovalGrants = new WeakSet<object>();

export type PendingToolApproval = Readonly<{
  token: string;
  toolId: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}>;

type ResolvedToolApproval = PendingToolApproval & Readonly<{
  arguments: Readonly<Record<string, unknown>>;
}>;

export type McpApprovalGrant = Readonly<{
  kind: "mcp-human-step" | "mcp-explicit-playwright-session";
  toolId: string;
  fingerprint: string;
}>;

type ApprovalFile = {
  version: 2;
  approvals: PendingToolApproval[];
};

type Clock = {
  now(): Date;
};

const systemClock: Clock = {
  now: () => new Date(),
};

export class ToolApprovalStore {
  private queue: Promise<void> = Promise.resolve();
  private readonly argumentsByToken = new Map<
    string,
    Readonly<Record<string, unknown>>
  >();
  private readonly filePath: string;
  private readonly clock: Clock;

  constructor(
    filePath = path.join(
      getLocalDataDir(),
      "pending-tool-approvals.json",
    ),
    clock: Clock = systemClock,
  ) {
    this.filePath = filePath;
    this.clock = clock;
  }

  request(
    toolId: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<PendingToolApproval> {
    return this.serial(async () => {
      const now = this.clock.now();
      const file = await this.load();
      const approvals = this.prune(file.approvals, now);
      const fingerprint = approvalFingerprint(toolId, args);
      const existingIndex = approvals.findIndex(
        (approval) =>
          !approval.consumedAt &&
          approval.fingerprint === fingerprint &&
          new Date(approval.expiresAt).getTime() > now.getTime(),
      );
      const existing = approvals[existingIndex];
      if (existing && this.argumentsByToken.has(existing.token)) {
        await this.save({ version: 2, approvals });
        return existing;
      }
      if (existingIndex >= 0) {
        approvals.splice(existingIndex, 1);
      }

      const approval: PendingToolApproval = Object.freeze({
        token: createUniqueApprovalToken(approvals),
        toolId,
        fingerprint,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
      });
      this.argumentsByToken.set(
        approval.token,
        cloneApprovalArguments(args),
      );
      approvals.push(approval);
      await this.save({ version: 2, approvals });
      return approval;
    });
  }

  peek(token: string): Promise<ResolvedToolApproval> {
    return this.serial(async () => {
      const now = this.clock.now();
      const file = await this.load();
      const approvals = this.prune(file.approvals, now);
      const approval = findPendingApproval(approvals, token, now);
      const args = this.argumentsByToken.get(approval.token);
      if (!args) {
        throw new Error(
          "O contexto seguro desta aprovação não está mais disponível. Solicite a ação novamente.",
        );
      }
      await this.save({ version: 2, approvals });
      return Object.freeze({ ...approval, arguments: args });
    });
  }

  consume(
    token: string,
    expectedToolId: string,
    expectedArgs: Readonly<Record<string, unknown>>,
  ): Promise<PendingToolApproval> {
    return this.serial(async () => {
      const now = this.clock.now();
      const file = await this.load();
      const approvals = this.prune(file.approvals, now);
      const approval = findPendingApproval(approvals, token, now);
      const expectedFingerprint = approvalFingerprint(
        expectedToolId,
        expectedArgs,
      );
      if (approval.fingerprint !== expectedFingerprint) {
        throw new Error(
          "A aprovação não corresponde exatamente à ferramenta e aos argumentos pendentes.",
        );
      }
      const consumed = Object.freeze({
        ...approval,
        consumedAt: now.toISOString(),
      });
      const index = approvals.findIndex((item) => item.token === approval.token);
      approvals[index] = consumed;
      await this.save({ version: 2, approvals });
      this.argumentsByToken.delete(approval.token);
      return consumed;
    });
  }

  scrubPersistedState(): Promise<void> {
    return this.serial(async () => {
      const file = await this.load();
      const approvals = this.prune(file.approvals, this.clock.now());
      await this.save({ version: 2, approvals });
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<ApprovalFile> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as Partial<ApprovalFile>;
      if (parsed.version === 2 && Array.isArray(parsed.approvals)) {
        return {
          version: 2,
          approvals: parsed.approvals
            .filter(isStoredApproval)
            .map(toStoredApproval),
        };
      }
    } catch {
      // Missing or malformed approval state grants no permission.
    }
    return { version: 2, approvals: [] };
  }

  private async save(file: ApprovalFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }

  private prune(
    approvals: readonly PendingToolApproval[],
    now: Date,
  ): PendingToolApproval[] {
    const pruned = pruneApprovals(approvals, now);
    const retainedTokens = new Set(pruned.map((approval) => approval.token));
    for (const token of this.argumentsByToken.keys()) {
      if (!retainedTokens.has(token)) {
        this.argumentsByToken.delete(token);
      }
    }
    return pruned;
  }
}

export const toolApprovalStore = new ToolApprovalStore();
void toolApprovalStore.scrubPersistedState().catch(() => undefined);

export function extractToolApprovalToken(intent: string): string | null {
  return TOKEN_PATTERN.exec(intent)?.[1]?.toUpperCase() ?? null;
}

export async function requestMcpToolApproval(
  tool: KaozTool,
  args: Readonly<Record<string, unknown>>,
  store = toolApprovalStore,
): Promise<{ approval: PendingToolApproval; message: string }> {
  if (tool.source !== "mcp") {
    throw new Error("Somente ferramentas MCP usam este gate de aprovação.");
  }
  assertToolArguments(tool.inputSchema, { ...args });
  const approval = await store.request(tool.id, args);
  const safeArguments = formatApprovalArguments(args);
  return {
    approval,
    message:
      `A ação externa ainda não foi executada.\n\n` +
      `Ferramenta: \`${tool.id}\`\n` +
      `Argumentos revisáveis:\n${safeArguments}\n` +
      `Fingerprint SHA-256 da chamada inteira: ` +
      `\`${approval.fingerprint}\`\n\n` +
      `Para autorizar exatamente esta chamada, envie: ` +
      `\`aprovar ${approval.token}\`. A autorização expira em 15 minutos e ` +
      `só pode ser usada uma vez. Reiniciar o Kaoz.1 cancela a aprovação pendente.`,
  };
}

export async function executeApprovedMcpToolFromIntent(
  intent: string,
  tools: readonly KaozTool[],
  execute: (
    tool: KaozTool,
    args: Readonly<Record<string, unknown>>,
    grant: McpApprovalGrant,
  ) => Promise<ToolResult>,
  store = toolApprovalStore,
): Promise<{ tool: KaozTool; result: ToolResult } | null> {
  const token = extractToolApprovalToken(intent);
  if (!token) return null;

  const approval = await store.peek(token);
  const tool = tools.find((candidate) => candidate.id === approval.toolId);
  if (!tool || tool.source !== "mcp" || !tool.enabled) {
    throw new Error(
      "A ferramenta MCP desta aprovação não está mais disponível.",
    );
  }
  assertToolArguments(tool.inputSchema, { ...approval.arguments });
  await store.consume(token, tool.id, approval.arguments);
  const grant = issueMcpApprovalGrant(tool.id, approval.arguments);
  const result = await execute(tool, approval.arguments, grant);
  return { tool, result };
}

export function consumeMcpApprovalGrant(
  grant: unknown,
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): void {
  if (!grant || typeof grant !== "object" || !issuedMcpApprovalGrants.has(grant)) {
    throw new Error(
      "Ferramenta MCP exige uma aprovação humana válida e de uso único.",
    );
  }
  issuedMcpApprovalGrants.delete(grant);
  const candidate = grant as Partial<McpApprovalGrant>;
  if (
    (candidate.kind !== "mcp-human-step" &&
      candidate.kind !== "mcp-explicit-playwright-session") ||
    candidate.toolId !== toolId ||
    candidate.fingerprint !== approvalFingerprint(toolId, args)
  ) {
    throw new Error(
      "A aprovação humana não corresponde à ferramenta e aos argumentos.",
    );
  }
}

export function issueExplicitPlaywrightMcpGrant(
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): McpApprovalGrant {
  if (!isPlaywrightMcpToolId(toolId)) {
    throw new Error("A autorizaÃ§Ã£o direta Ã© exclusiva do MCP Playwright Browser.");
  }
  return issueMcpGrant(
    "mcp-explicit-playwright-session",
    toolId,
    args,
  );
}

function findPendingApproval(
  approvals: PendingToolApproval[],
  token: string,
  now: Date,
): PendingToolApproval {
  const normalized = token.trim().toUpperCase();
  const approval = approvals.find((item) => item.token === normalized);
  if (!approval) {
    throw new Error("Aprovação inexistente ou expirada.");
  }
  if (approval.consumedAt) {
    throw new Error("Esta aprovação já foi utilizada.");
  }
  if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
    throw new Error("Esta aprovação expirou.");
  }
  return approval;
}

function pruneApprovals(
  approvals: readonly PendingToolApproval[],
  now: Date,
): PendingToolApproval[] {
  const oldestConsumed = now.getTime() - CONSUMED_RETENTION_MS;
  return approvals.filter((approval) => {
    if (approval.consumedAt) {
      return new Date(approval.consumedAt).getTime() > oldestConsumed;
    }
    return new Date(approval.expiresAt).getTime() > now.getTime();
  });
}

function approvalFingerprint(
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
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function createApprovalToken(): string {
  return crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)
    .toUpperCase();
}

function createUniqueApprovalToken(
  approvals: readonly PendingToolApproval[],
): string {
  let token = createApprovalToken();
  while (approvals.some((approval) => approval.token === token)) {
    token = createApprovalToken();
  }
  return token;
}

function issueMcpApprovalGrant(
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): McpApprovalGrant {
  return issueMcpGrant("mcp-human-step", toolId, args);
}

function issueMcpGrant(
  kind: McpApprovalGrant["kind"],
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): McpApprovalGrant {
  const grant = Object.freeze({
    kind,
    toolId,
    fingerprint: approvalFingerprint(toolId, args),
  });
  issuedMcpApprovalGrants.add(grant);
  return grant;
}

function isStoredApproval(value: unknown): value is PendingToolApproval {
  if (!value || typeof value !== "object") return false;
  const approval = value as Partial<PendingToolApproval>;
  return (
    typeof approval.token === "string" &&
    /^[A-F0-9]{12}$/.test(approval.token) &&
    typeof approval.toolId === "string" &&
    typeof approval.fingerprint === "string" &&
    typeof approval.createdAt === "string" &&
    typeof approval.expiresAt === "string"
  );
}

function toStoredApproval(
  approval: PendingToolApproval,
): PendingToolApproval {
  return Object.freeze({
    token: approval.token,
    toolId: approval.toolId,
    fingerprint: approval.fingerprint,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    ...(approval.consumedAt ? { consumedAt: approval.consumedAt } : {}),
  });
}

function cloneApprovalArguments(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return deepFreeze(structuredClone(args)) as Readonly<
    Record<string, unknown>
  >;
}

function deepFreeze(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }
  return Object.freeze(value);
}

function formatApprovalArguments(
  args: Readonly<Record<string, unknown>>,
): string {
  const sanitized = sanitizeSensitiveValue(args) as Record<string, unknown>;
  const entries = Object.keys(sanitized)
    .sort()
    .map((key) => {
      const safeKey = escapeInlineCode(key);
      const summary = summarizeApprovalValue(sanitized[key]);
      return `- \`${safeKey}\`: \`${summary}\``;
    });
  return entries.length > 0 ? `${entries.join("\n")}\n` : "- (nenhum)\n";
}

function summarizeApprovalValue(value: unknown): string {
  const serialized = redactSecrets(stableStringify(value));
  if (serialized.length <= 240) {
    return escapeInlineCode(serialized);
  }
  const digest = createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
  if (Array.isArray(value)) {
    return `${value.length} itens; SHA-256 ${digest}`;
  }
  if (value && typeof value === "object") {
    return `${Object.keys(value).length} campos; SHA-256 ${digest}`;
  }
  if (typeof value === "string") {
    const prefix = escapeInlineCode(JSON.stringify(value.slice(0, 120)));
    return `${value.length} caracteres; início ${prefix}; SHA-256 ${digest}`;
  }
  return `valor longo; SHA-256 ${digest}`;
}

function escapeInlineCode(value: string): string {
  return value
    .replaceAll("`", "\\u0060")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}
