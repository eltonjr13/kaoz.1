import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry, validateSkill } from "../services/skills/skill.registry.ts";
import { createSkillScriptHandler } from "../services/orchestrator/adapters/skill-script.adapter.ts";
import { skillRegistry } from "../services/skills/skill.registry.ts";
import type { KaozSkill } from "../services/skills/skill.types.ts";

function textSkill(version: string, instructions = `Instruções ${version}`): KaozSkill {
  return {
    id: "teste-publicacao",
    name: "Teste de publicação",
    description: "Skill temporária usada para validar publicação.",
    version,
    instructions,
    preferredTools: [],
    requiredCapabilities: [],
    approvalMode: "plan",
    enabled: true,
    tools: [],
    references: [],
    scripts: [],
  };
}

test("seleciona skill específica por intenção e respeita comando explícito", () => {
  assert.equal(skillRegistry.select("analise as métricas e retenção deste vídeo").id, "analisador-de-metricas");
  assert.equal(skillRegistry.select("/gerador-de-hashtags gere tags para culinária").id, "gerador-de-hashtags");
  assert.equal(skillRegistry.select("crie uma skill para organizar despesas").id, "build-skills");
});

test("rejeita rede sem capacidade web", () => {
  const skill = textSkill("1.0.0");
  skill.tools = [{
    id: "skill:teste-publicacao:buscar",
    description: "Busca dados.",
    script: "scripts/buscar.ts",
    inputSchema: { type: "object" },
    policy: { network: true, fileRead: "skill", fileWrite: "none", subprocess: false, timeoutMs: 1_000, maxMemoryMb: 64, maxOutputBytes: 10_000 },
  }];
  skill.scripts = [{ name: "buscar.ts", content: "console.log('{}')" }];
  assert.throws(() => validateSkill(skill), /capacidade web/);
});

test("publicação inválida preserva versão saudável e rollback restaura snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-skills-"));
  try {
    const registry = new SkillRegistry(root);
    registry.save(textSkill("1.0.0", "versão saudável"));
    registry.save(textSkill("2.0.0", "nova versão"));
    const revision = registry.listRevisions("teste-publicacao")[0];
    assert.equal(revision.version, "1.0.0");

    const invalid = textSkill("3.0.0", "versão inválida");
    invalid.tools = [{ id: "skill:teste-publicacao:ausente", description: "Sem script.", script: "scripts/ausente.ts", inputSchema: {} }];
    assert.throws(() => registry.save(invalid), /não existe no pacote/);
    assert.equal(registry.get("teste-publicacao")?.version, "2.0.0");

    const restored = registry.rollback("teste-publicacao", revision.id);
    assert.equal(restored.version, "1.0.0");
    assert.match(await readFile(path.join(root, "skills", "teste-publicacao", "SKILL.md"), "utf8"), /versão saudável/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor isola ambiente, aplica limites e registra métricas", async () => {
  const skill = skillRegistry.get("calculadora-de-gorjeta");
  const tool = skill?.tools?.[0];
  assert.ok(skill && tool);
  const handler = createSkillScriptHandler(skill.id, tool);
  const result = await handler({ valorConta: 100, porcentagem: 10 }, { planId: "test", runId: "test", stepId: "test", signal: new AbortController().signal });
  assert.equal((result.output as { totalAPagar?: number }).totalAPagar, 110);
  assert.equal(result.metrics?.success, true);
  assert.ok((result.metrics?.durationMs || 0) >= 0);
  assert.ok((result.metrics?.stdoutBytes || 0) > 0);
  assert.equal(result.metrics?.limits.maxMemoryMb, 128);
});

test("sandbox bloqueia script com rede não declarada antes da execução", async () => {
  const skill = skillRegistry.get("trend-hunter");
  const original = skill?.tools?.[0];
  assert.ok(skill && original);
  const handler = createSkillScriptHandler(skill.id, { ...original, policy: { ...original.policy!, network: false } });
  await assert.rejects(
    handler({ niche: "tecnologia" }, { planId: "test", runId: "test", stepId: "test", signal: new AbortController().signal }),
    /acessar a rede sem declarar/
  );
});
