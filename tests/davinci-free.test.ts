import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Resolve Free expõe ferramentas rastreáveis e mutações com aprovação por etapa", async () => {
  const registry = await readFile(
    path.join(process.cwd(), "services", "tools", "tool.registry.ts"),
    "utf8",
  );
  for (const id of [
    "davinci-free:get-status",
    "davinci-free:install-runner",
    "davinci-free:prepare-voice",
    "davinci-free:prepare-edit-plan",
  ]) {
    assert.match(registry, new RegExp(id.replaceAll("-", "\\-")));
  }
  for (const id of [
    "davinci-free:install-runner",
    "davinci-free:prepare-voice",
    "davinci-free:prepare-edit-plan",
  ]) {
    const start = registry.indexOf(`{id:"${id}"`);
    assert.notEqual(start, -1);
    assert.match(registry.slice(start, registry.indexOf("\n", start)), /approvalMode:"step"/);
  }
});

test("runner interno não abre servidor nem executa código arbitrário", async () => {
  const runner = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "runner", "Kaoz1ApplyPlan.py"),
    "utf8",
  );
  assert.doesNotMatch(runner, /\b(socket|subprocess|exec|eval|os\.system)\s*\(/);
  assert.match(runner, /CreateEmptyTimeline/);
  assert.match(runner, /Workspace > Scripts/);
  assert.match(runner, /requestId/);
});

test("plano valida caminhos locais, faixa musical e slot pendente único", async () => {
  const service = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "davinci-free.service.ts"),
    "utf8",
  );
  assert.match(service, /path\.win32\.isAbsolute/);
  assert.match(service, /raw\.startsWith\("\\\\\\\\"\)/);
  assert.match(service, /Math\.min\(-35, Math\.max\(-40/);
  assert.match(service, /Já existe um plano pendente/);
});

test("desktop inclui o runner do Resolve Free", async () => {
  const prepare = await readFile(path.join(process.cwd(), "scripts", "prepare-desktop-build.mjs"), "utf8");
  const smoke = await readFile(path.join(process.cwd(), "scripts", "smoke-desktop-standalone.mjs"), "utf8");
  assert.match(prepare, /davinciFreeSource/);
  assert.match(smoke, /Kaoz1ApplyPlan\.py/);
});
