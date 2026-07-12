import test from "node:test";
import assert from "node:assert/strict";
import { isBuildSkillsIntent } from "../services/skills/skill.intent.ts";

test("build-skills vence termos de video", () => {
  assert.equal(isBuildSkillsIntent("Quero criar uma skill para gerar roteiros de videos curtos."), true);
});

test("reconhece comando build-skills", () => {
  assert.equal(isBuildSkillsIntent("/build-skills uma skill de imagens"), true);
});

test("video comum nao ativa build-skills", () => {
  assert.equal(isBuildSkillsIntent("Crie um video curto para o TikTok"), false);
});
