import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("navegacao principal nao expoe as superficies legadas", async () => {
  const shell = await readSource("components/layout/app-shell.tsx");

  assert.doesNotMatch(shell, /href:\s*"\/jobs"/);
  assert.doesNotMatch(shell, /href:\s*"\/jobs\/new"/);
  assert.doesNotMatch(shell, /href:\s*"\/avatars"/);
  assert.doesNotMatch(shell, /label:\s*"Projects"/);
  assert.doesNotMatch(shell, /label:\s*"Avatar"/);
  assert.doesNotMatch(shell, /label:\s*"Generation"/);
});

test("agente atual nao carrega nem oferece avatar ou modo Fly", async () => {
  const page = await readSource("app/(dashboard)/flow/page.tsx");

  assert.doesNotMatch(page, /\/api\/avatars/);
  assert.doesNotMatch(page, /selectedAvatarId/);
  assert.doesNotMatch(page, /useAvatarPersonality/);
  assert.doesNotMatch(page, /useAvatarVisualReference/);
  assert.doesNotMatch(page, /FlyModeWizard/);
  assert.doesNotMatch(page, /\{\s*id:\s*"project",\s*label:\s*"React"/);
  assert.match(page, /criar imagens, vídeos e criativos de anúncio/);
});

test("aprovacao usa a identidade do workspace e nao exige avatar", async () => {
  const route = await readSource("app/api/flow/agent/route.ts");
  const chatRoute = await readSource("app/api/flow/chat/route.ts");

  assert.doesNotMatch(route, /findLocalAvatar/);
  assert.doesNotMatch(route, /Avatar local nao encontrado/);
  assert.doesNotMatch(route, /!taskPrompt\s*\|\|\s*!avatarId/);
  assert.match(route, /avatarId:\s*APP_WORKSPACE_ID/);
  assert.match(route, /useAvatarVisualReference:\s*false/);
  assert.match(route, /useAvatarPersonality:\s*false/);
  assert.doesNotMatch(chatRoute, /findLocalAvatar/);
  assert.doesNotMatch(chatRoute, /useAvatarPersonality/);
});

test("falhas anteriores ao job continuam visiveis e Flow grava fora do app instalado", async () => {
  const page = await readSource("app/(dashboard)/flow/page.tsx");
  const flowUtils = await readSource("src/providers/flow/FlowUtils.ts");

  assert.doesNotMatch(page, /msg\.jobId\s*&&\s*\(msg\.jobStatus === 'failed'/);
  assert.match(page, /\(msg\.jobStatus === 'failed'/);
  assert.match(flowUtils, /path\.join\(getFlowStorageRoot\(\), 'flow_project_url\.txt'\)/);
  assert.doesNotMatch(flowUtils, /const filePath = 'storage\/flow_project_url\.txt'/);
});
