import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSkillGenerationJson,
  querySkillGenerationJson,
} from "../services/skills/skill.generation.ts";

test("extrai o objeto JSON mesmo quando o provedor adiciona uma cerca Markdown", () => {
  assert.deepEqual(
    extractSkillGenerationJson('```json\n{"ready":false,"skill":null}\n```'),
    { ready: false, skill: null },
  );
});

test("solicita modo JSON e refaz uma resposta estruturalmente inválida uma vez", async () => {
  const calls: Array<{ prompt: string; options: unknown }> = [];
  const parsed = await querySkillGenerationJson("PROMPT", async (prompt, options) => {
    calls.push({ prompt, options });
    return calls.length === 1 ? "resposta truncada" : '{"ready":true,"skill":{"id":"teste"}}';
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options, { jsonMode: true, maxOutputTokens: 16_000 });
  assert.match(calls[1].prompt, /CORREÇÃO OBRIGATÓRIA/);
  assert.equal((parsed.skill as { id: string }).id, "teste");
});

test("não repete falhas do provedor que não sejam de estrutura", async () => {
  let calls = 0;
  await assert.rejects(
    querySkillGenerationJson("PROMPT", async () => {
      calls += 1;
      throw new Error("HTTP 500 upstream");
    }),
    /HTTP 500 upstream/,
  );
  assert.equal(calls, 1);
});

test("refaz JSON válido quando o pacote não passa na validação semântica", async () => {
  let calls = 0;
  const parsed = await querySkillGenerationJson(
    "PROMPT",
    async () => {
      calls += 1;
      return calls === 1
        ? '{"ready":true,"skill":null}'
        : '{"ready":true,"skill":{"id":"corrigida"}}';
    },
    (candidate) => {
      if (candidate.ready === true && !candidate.skill) throw new Error("pacote inconsistente");
    },
  );

  assert.equal(calls, 2);
  assert.deepEqual(parsed.skill, { id: "corrigida" });
});
