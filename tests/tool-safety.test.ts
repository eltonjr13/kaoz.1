import assert from "node:assert/strict";
import test from "node:test";

import { buildSafeMcpEnvironment } from "../services/mcp/mcp.security.ts";
import { mcpToolId, parseMcpToolId } from "../services/mcp/mcp-tool-id.ts";
import { assertSafeWorkspacePath, redactSecrets, requiredApproval } from "../services/orchestrator/orchestrator.policy.ts";
import { parseSkillMarkdown } from "../services/skills/skill.parser.ts";
import { assertToolArguments } from "../services/tools/tool.validation.ts";

test("valida argumentos da ferramenta", () => {
  const schema = {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string" } },
    additionalProperties: false,
  };

  assert.doesNotThrow(() => assertToolArguments(schema, { query: "MrChicken" }));
  assert.throws(() => assertToolArguments(schema, {}), /obrigatório/);
  assert.throws(() => assertToolArguments(schema, { query: 42 }), /inválido/);
  assert.throws(() => assertToolArguments(schema, { query: "ok", extra: true }), /não permitido/);
});

test("aplica a aprovação mínima exigida pelo efeito", () => {
  assert.equal(requiredApproval("destructive", "never"), "step");
  assert.equal(requiredApproval("external", "plan"), "step");
  assert.equal(requiredApproval("write", "never"), "plan");
  assert.equal(requiredApproval("read", "never"), "never");
});

test("protege caminhos e remove segredos de logs", () => {
  assert.throws(() => assertSafeWorkspacePath("../segredo", process.cwd()), /fora da raiz/);
  assert.match(assertSafeWorkspacePath(".generated/a.json", process.cwd()), /\.generated/);

  const redacted = redactSecrets("api_key=abc123 token: xyz987 password=qwerty");
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("xyz987"), false);
  assert.equal(redacted.includes("qwerty"), false);
});

test("MCP usa ambiente permitido e identificadores seguros", () => {
  const env = buildSafeMcpEnvironment(
    { CUSTOM: "ok" },
    { PATH: "bin", SECRET_TOKEN: "não", HOME: "home" },
  );
  assert.deepEqual(env, { PATH: "bin", HOME: "home", CUSTOM: "ok" });
  assert.deepEqual(parseMcpToolId(mcpToolId("server-1", "search.web")), {
    serverId: "server-1",
    toolName: "search.web",
  });
  assert.throws(() => mcpToolId("../server", "tool"), /inválido/);
});

test("parser preserva a ferramenta declarada pela skill", () => {
  const markdown = `---
name: "Calculadora de Gorjeta"
description: "Sabe como calcular gorjetas"
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: "plan"
enabled: "true"
tools:
  - id: "skill:calculadora:calcular"
    description: "Calcula o valor da gorjeta."
    script: "scripts/calc.js"
    inputSchema:
      type: "object"
      required: ["valorConta"]
---
Você é um especialista em calcular contas.`;

  const skill = parseSkillMarkdown("calculadora", markdown);
  assert.equal(skill.enabled, true);
  assert.equal(skill.tools?.length, 1);
  assert.equal(skill.tools?.[0].id, "skill:calculadora:calcular");
  assert.deepEqual(skill.tools?.[0].inputSchema.required, ["valorConta"]);
});
