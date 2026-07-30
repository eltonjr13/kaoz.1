import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentId } from "../services/agents/core/agent-id.ts";
import { consumeMcpCallAuthorization } from "../services/mcp/mcp-call.authorization.ts";
import {
  redactSecrets,
  sanitizePublicErrorMessage,
} from "../services/orchestrator/orchestrator.policy.ts";
import {
  ToolApprovalStore,
  executeApprovedMcpToolFromIntent,
  extractToolApprovalToken,
  requestMcpToolApproval,
} from "../services/tools/tool-approval.service.ts";
import { presentApprovedMcpResult } from "../services/tools/tool-approval.presentation.ts";
import { ToolExecutionService } from "../services/tools/tool-execution.service.ts";
import type { KaozTool } from "../services/tools/tool.types.ts";

const resolveTool: KaozTool = {
  id: "mcp:davinci-resolve-local:resolve_create_timeline",
  name: "resolve_create_timeline",
  description: "Cria uma timeline nova.",
  source: "mcp",
  inputSchema: {
    type: "object",
    required: ["name", "requestId"],
    properties: {
      name: { type: "string" },
      requestId: { type: "string" },
    },
    additionalProperties: false,
  },
  effect: "external",
  approvalMode: "step",
  timeoutMs: 45_000,
  enabled: true,
};

function mcpExecutionRequest(
  args: Readonly<Record<string, unknown>>,
  approvalGrant?: unknown,
): Parameters<ToolExecutionService["execute"]>[0] {
  return {
    agentId: createAgentId("approval-integration-agent"),
    toolId: resolveTool.id,
    arguments: { ...args },
    context: {
      planId: "approval-plan",
      runId: "approval-run",
      stepId: "approval-step",
      signal: new AbortController().signal,
    },
    permissions: {
      allowedToolIds: [resolveTool.id],
      approvalMode: "step",
      reason: "Token humano de uso único validado.",
    },
    approvalGrant,
    correlationId: "approval-integration-correlation",
  };
}

test("MCP permanece pendente até uma aprovação explícita de uso único", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-approval-"));
  try {
    const store = new ToolApprovalStore(path.join(root, "approvals.json"));
    const args = {
      name: "Aula 1",
      requestId: "request-approval-1234",
    };
    let executions = 0;

    const pending = await requestMcpToolApproval(resolveTool, args, store);
    assert.equal(executions, 0);
    assert.match(pending.message, new RegExp(`aprovar ${pending.approval.token}`));

    const approved = await executeApprovedMcpToolFromIntent(
      `aprovar ${pending.approval.token}`,
      [resolveTool],
      async (_tool, storedArguments) => {
        executions += 1;
        assert.deepEqual(storedArguments, args);
        return { output: { created: true } };
      },
      store,
    );

    assert.equal(executions, 1);
    assert.deepEqual(approved?.result.output, { created: true });
    await assert.rejects(
      executeApprovedMcpToolFromIntent(
        `aprovar ${pending.approval.token}`,
        [resolveTool],
        async () => {
          executions += 1;
          return { output: null };
        },
        store,
      ),
      /já foi utilizada/,
    );
    assert.equal(executions, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("aprovação vincula toolId e argumentos e expira sem conceder permissão", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-expiry-"));
  let now = new Date("2026-07-29T12:00:00.000Z");
  try {
    const store = new ToolApprovalStore(
      path.join(root, "approvals.json"),
      { now: () => now },
    );
    const args = {
      name: "Aula segura",
      requestId: "request-expiry-1234",
    };
    const pending = await requestMcpToolApproval(resolveTool, args, store);

    await assert.rejects(
      store.consume(
        pending.approval.token,
        resolveTool.id,
        { ...args, name: "Argumentos alterados" },
      ),
      /não corresponde exatamente/,
    );

    now = new Date("2026-07-29T12:16:00.000Z");
    await assert.rejects(
      executeApprovedMcpToolFromIntent(
        `aprovar ${pending.approval.token}`,
        [resolveTool],
        async () => ({ output: null }),
        store,
      ),
      /inexistente ou expirada|expirou/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("argumentos inválidos não geram token de aprovação", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-invalid-"));
  try {
    const store = new ToolApprovalStore(path.join(root, "approvals.json"));
    await assert.rejects(
      requestMcpToolApproval(
        resolveTool,
        { requestId: "request-invalid-1234" },
        store,
      ),
      /obrigatório/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("somente o comando inteiro e afirmativo reconhece o token", () => {
  const token = "ABCDEF123456";
  assert.equal(extractToolApprovalToken(`aprovar ${token}`), token);
  assert.equal(extractToolApprovalToken(`  APROVAR ${token}  `), token);
  assert.equal(extractToolApprovalToken(`não aprovar ${token}`), null);
  assert.equal(extractToolApprovalToken(`"aprovar ${token}"`), null);
  assert.equal(
    extractToolApprovalToken(`explique como aprovar ${token}`),
    null,
  );
  assert.equal(extractToolApprovalToken(`aprovar ${token} depois`), null);
});

test("redação remove Bearer, JWT e credenciais embutidas em texto livre", () => {
  const bearer = "bearer-secret-0123456789";
  const genericBearer = "generic-bearer-secret-9876543210";
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureSecret123";
  const openAiKey = "sk-abcdefghijklmnopqrstuvwxyz";
  const githubToken = "ghp_abcdefghijklmnopqrstuvwxyz";
  const output = redactSecrets(
    [
      `Authorization: Bearer ${bearer}`,
      `falha com Bearer ${genericBearer}`,
      `jwt=${jwt}`,
      `--refresh-token cli-refresh-secret`,
      `{"token":"json-token-secret"}`,
      `https://local-user:local-password@example.test/path`,
      openAiKey,
      githubToken,
      "pageToken=next-page-marker",
    ].join("\n"),
  );

  assert.doesNotMatch(
    output,
    /bearer-secret|generic-bearer-secret|signatureSecret|cli-refresh-secret|json-token-secret|local-user|local-password|sk-abcdefghijklmnopqrstuvwxyz|ghp_abcdefghijklmnopqrstuvwxyz/,
  );
  assert.match(output, /Authorization: Bearer \[REDACTED\]/);
  assert.match(output, /pageToken=next-page-marker/);
});

test("erro público preserva código e remove comando, path e credenciais", () => {
  const error = Object.assign(
    new Error(
      'Command failed: "C:\\Users\\elton\\AppData\\runner.exe" --token command-secret\n' +
      "Authorization: Bearer error-bearer-secret-0123456789",
    ),
    { code: "REQUEST_ID_CONFLICT" },
  );
  const message = sanitizePublicErrorMessage(error);

  assert.match(message, /REQUEST_ID_CONFLICT/);
  assert.match(message, /\[REDACTED\]/);
  assert.doesNotMatch(
    message,
    /C:\\Users|runner\.exe|command-secret|error-bearer-secret/,
  );
});

test("resumo de aprovação não esconde cauda nem permite injeção Markdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-summary-"));
  try {
    const store = new ToolApprovalStore(path.join(root, "approvals.json"));
    const displayTool: KaozTool = {
      ...resolveTool,
      id: "mcp:test:long-payload",
      inputSchema: {
        type: "object",
        required: ["payload", "items"],
        properties: {
          payload: { type: "string" },
          items: { type: "array" },
        },
        additionalProperties: false,
      },
    };
    const pending = await requestMcpToolApproval(
      displayTool,
      {
        payload: `início \`\`\` falso\n${"x".repeat(500)}`,
        items: Array.from({ length: 300 }, (_, index) => index),
      },
      store,
    );

    assert.match(pending.message, /300 itens; SHA-256 [a-f0-9]{64}/);
    assert.match(pending.message, /\\u0060\\u0060\\u0060/);
    assert.ok(pending.message.includes(pending.approval.fingerprint));
    assert.doesNotMatch(pending.message, /``` falso/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("argumentos de aprovação redigem tokens sem ocultar métricas de tokens", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-token-redaction-"));
  try {
    const store = new ToolApprovalStore(path.join(root, "approvals.json"));
    const tokenTool: KaozTool = {
      ...resolveTool,
      id: "mcp:test:token-redaction",
      inputSchema: {
        type: "object",
        required: [
          "token",
          "refresh_token",
          "refreshToken",
          "REFRESH_TOKEN",
          "tokenCount",
          "maxTokens",
          "designToken",
          "pageToken",
        ],
        properties: {
          token: { type: "string" },
          refresh_token: { type: "string" },
          refreshToken: { type: "string" },
          REFRESH_TOKEN: { type: "string" },
          tokenCount: { type: "number" },
          maxTokens: { type: "number" },
          designToken: { type: "string" },
          pageToken: { type: "string" },
        },
        additionalProperties: false,
      },
    };
    const pending = await requestMcpToolApproval(
      tokenTool,
      {
        token: "plain-token-secret",
        refresh_token: "snake-refresh-secret",
        refreshToken: "camel-refresh-secret",
        REFRESH_TOKEN: "upper-refresh-secret",
        tokenCount: 12,
        maxTokens: 24,
        designToken: "primary-action",
        pageToken: "next-page-marker",
      },
      store,
    );

    assert.doesNotMatch(
      pending.message,
      /plain-token-secret|snake-refresh-secret|camel-refresh-secret|upper-refresh-secret/,
    );
    assert.match(pending.message, /`token`: `"\[REDACTED\]"`/);
    assert.match(pending.message, /`refresh_token`: `"\[REDACTED\]"`/);
    assert.match(pending.message, /`refreshToken`: `"\[REDACTED\]"`/);
    assert.match(pending.message, /`REFRESH_TOKEN`: `"\[REDACTED\]"`/);
    assert.match(pending.message, /`tokenCount`: `12`/);
    assert.match(pending.message, /`maxTokens`: `24`/);
    assert.match(pending.message, /`designToken`: `"primary-action"`/);
    assert.match(pending.message, /`pageToken`: `"next-page-marker"`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("estado persistido não contém argumentos ou segredos MCP", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-at-rest-"));
  const filePath = path.join(root, "approvals.json");
  try {
    const store = new ToolApprovalStore(filePath);
    const secretTool: KaozTool = {
      ...resolveTool,
      id: "mcp:test:secret",
      inputSchema: {
        type: "object",
        required: ["requestId", "apiKey"],
        properties: {
          requestId: { type: "string" },
          apiKey: { type: "string" },
        },
        additionalProperties: false,
      },
    };
    const args = {
      requestId: "request-secret-1234",
      apiKey: "super-secret-approval-value",
    };
    const pending = await requestMcpToolApproval(secretTool, args, store);
    const persisted = await readFile(filePath, "utf8");

    assert.doesNotMatch(persisted, /super-secret-approval-value/);
    assert.doesNotMatch(persisted, /"arguments"/);
    assert.match(persisted, /"version": 2/);

    const restarted = new ToolApprovalStore(filePath);
    await assert.rejects(
      executeApprovedMcpToolFromIntent(
        `aprovar ${pending.approval.token}`,
        [secretTool],
        async () => ({ output: null }),
        restarted,
      ),
      /contexto seguro.*não está mais disponível/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migração remove argumentos legados em texto claro", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-legacy-"));
  const filePath = path.join(root, "approvals.json");
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        approvals: [{
          token: "ABCDEF123456",
          toolId: resolveTool.id,
          arguments: { password: "legacy-plain-secret" },
          fingerprint: "a".repeat(64),
          createdAt: "2026-07-29T12:00:00.000Z",
          expiresAt: "2026-07-29T12:15:00.000Z",
        }],
      }),
      "utf8",
    );
    const store = new ToolApprovalStore(filePath, {
      now: () => new Date("2026-07-29T12:01:00.000Z"),
    });

    await store.scrubPersistedState();
    const migrated = await readFile(filePath, "utf8");

    assert.doesNotMatch(migrated, /legacy-plain-secret|arguments/);
    assert.match(migrated, /"version": 2/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat e manager não mantêm atalhos MCP com efeitos ocultos", async () => {
  const [chatRoute, manager, agentLlm] = await Promise.all([
    readFile(
      path.join(process.cwd(), "app", "api", "flow", "chat", "route.ts"),
      "utf8",
    ),
    readFile(
      path.join(process.cwd(), "services", "mcp", "mcp.manager.ts"),
      "utf8",
    ),
    readFile(
      path.join(process.cwd(), "services", "agent-llm", "agent-llm.service.ts"),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(chatRoute, /\bMcpManager\b|mcpManager\.callTool/);
  assert.doesNotMatch(
    manager,
    /generateAndUploadCover|upload_playlist_cover/,
  );
  assert.match(manager, /consumeMcpCallAuthorization/);
  const approvedExecution = agentLlm.slice(
    agentLlm.indexOf("if (extractToolApprovalToken"),
    agentLlm.indexOf("let relevantTools"),
  );
  assert.match(
    approvedExecution,
    /sanitizePublicErrorMessage\(error\)/,
  );
  assert.doesNotMatch(
    approvedExecution,
    /error instanceof Error \? error\.message/,
  );
});

test("somente o adaptador central pode chamar McpManager.callTool", async () => {
  const allowedCallers = new Set([
    path.join("services", "mcp", "mcp.manager.ts"),
    path.join("services", "orchestrator", "adapters", "mcp.adapter.ts"),
  ]);
  const violations: string[] = [];
  for (const root of ["app", "services"]) {
    for (const file of await walkSource(path.join(process.cwd(), root))) {
      const relative = path.relative(process.cwd(), file);
      const content = await readFile(file, "utf8");
      if (/\.callTool\s*\(/.test(content) && !allowedCallers.has(relative)) {
        violations.push(relative);
      }
      if (
        /issueMcpCallAuthorization/.test(content) &&
        relative !== path.join(
          "services",
          "mcp",
          "mcp-call.authorization.ts",
        ) &&
        relative !== path.join(
          "services",
          "tools",
          "tool-execution.service.ts",
        )
      ) {
        violations.push(`${relative}:authorization-issuer`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("falha do resumo não informa falsamente que a chamada MCP falhou", async () => {
  const response = await presentApprovedMcpResult(
    "Crie a timeline",
    {
      output: {
        created: true,
        timelineName: "Aula 1",
        apiKey: "secret-result-value",
        token: "fallback-token-secret",
        refresh_token: "fallback-refresh-secret",
      },
    },
    async () => {
      throw Object.assign(
        new Error(
          'Command failed: "C:\\Users\\elton\\AppData\\Local\\runner.exe" --token presentation-cli-secret\n' +
            "Authorization: Bearer secret-presentation-value",
        ),
        { code: "PRESENTATION_FAILED" },
      );
    },
  );
  const parsed = JSON.parse(response) as { message?: string };

  assert.match(parsed.message || "", /já foi executada uma única vez/);
  assert.match(parsed.message || "", /"created":true/);
  assert.match(parsed.message || "", /\[REDACTED\]/);
  assert.match(parsed.message || "", /PRESENTATION_FAILED/);
  assert.doesNotMatch(
    parsed.message || "",
    /C:\\Users|runner\.exe|secret-result-value|secret-presentation-value|presentation-cli-secret|fallback-token-secret|fallback-refresh-secret/,
  );
  assert.doesNotMatch(parsed.message || "", /não foi possível executar/i);
});

test("resultado MCP entregue ao LLM redige tokens e preserva métricas", async () => {
  let presentationPrompt = "";
  const response = await presentApprovedMcpResult(
    "Consulte o serviço",
    {
      output: {
        token: "llm-token-secret",
        refreshToken: "llm-refresh-secret",
        REFRESH_TOKEN: "llm-upper-refresh-secret",
        tokenCount: 18,
        maxTokens: 36,
      },
    },
    async (prompt) => {
      presentationPrompt = prompt;
      return "Resumo seguro";
    },
  );

  assert.equal(response, "Resumo seguro");
  assert.doesNotMatch(
    presentationPrompt,
    /llm-token-secret|llm-refresh-secret|llm-upper-refresh-secret/,
  );
  assert.match(presentationPrompt, /"token":"\[REDACTED\]"/);
  assert.match(presentationPrompt, /"refreshToken":"\[REDACTED\]"/);
  assert.match(presentationPrompt, /"REFRESH_TOKEN":"\[REDACTED\]"/);
  assert.match(presentationPrompt, /"tokenCount":18/);
  assert.match(presentationPrompt, /"maxTokens":36/);
});

test("aprovação DaVinci executa pelo ToolExecutionService e gera auditoria", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-tool-service-"));
  let handlerExecutions = 0;
  try {
    const store = new ToolApprovalStore(path.join(root, "approvals.json"));
    const service = new ToolExecutionService({
      catalog: {
        list: async () => [resolveTool],
        get: async (id) => id === resolveTool.id ? resolveTool : undefined,
        handler: (id) => id === resolveTool.id
          ? async (args, context) => {
              consumeMcpCallAuthorization(
                context.mcpCallAuthorization,
                resolveTool.id,
                args,
              );
              handlerExecutions += 1;
              return { output: { timelineName: args.name } };
            }
          : undefined,
      },
    });
    const args = {
      name: "Aula auditada",
      requestId: "request-service-1234",
    };
    await assert.rejects(
      service.execute(mcpExecutionRequest(args)),
      /aprovação humana válida e de uso único/,
    );
    assert.equal(handlerExecutions, 0);

    const pending = await requestMcpToolApproval(resolveTool, args, store);
    let consumedGrant: unknown;

    const approved = await executeApprovedMcpToolFromIntent(
      `aprovar ${pending.approval.token}`,
      [resolveTool],
      async (tool, storedArguments, approvalGrant) => {
        consumedGrant = approvalGrant;
        assert.equal(tool.id, resolveTool.id);
        const execution = await service.execute(
          mcpExecutionRequest(storedArguments, approvalGrant),
        );
        return execution.result;
      },
      store,
    );

    assert.equal(handlerExecutions, 1);
    assert.deepEqual(approved?.result.output, {
      timelineName: "Aula auditada",
    });
    await assert.rejects(
      service.execute(mcpExecutionRequest(args, consumedGrant)),
      /aprovação humana válida e de uso único/,
    );
    assert.equal(handlerExecutions, 1);

    const audit = service.listAudit().find((entry) => entry.success);
    assert.equal(audit?.toolId, resolveTool.id);
    assert.equal(audit?.permissionDecision, "allowed");
    assert.equal(audit?.grantedApproval, "step");
    assert.equal(audit?.success, true);
    service.shutdown();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function walkSource(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name.startsWith(".generated")
    ) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkSource(fullPath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}
