import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sortCourseVideoPaths } from "../services/davinci-free/course-batch.order.ts";

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
    "davinci-free:analyze-intelligent",
    "davinci-free:render-intelligent",
    "davinci-free:approve-intelligent",
    "davinci-free:archive-pending",
    "davinci-free:choose-course-folder",
    "davinci-free:discover-batch",
    "davinci-free:start-batch",
    "davinci-free:get-batch",
    "davinci-free:retry-batch",
  ]) {
    assert.match(registry, new RegExp(id.replaceAll("-", "\\-")));
  }
  for (const id of [
    "davinci-free:install-runner",
    "davinci-free:prepare-voice",
    "davinci-free:prepare-edit-plan",
    "davinci-free:analyze-intelligent",
    "davinci-free:render-intelligent",
    "davinci-free:approve-intelligent",
    "davinci-free:archive-pending",
    "davinci-free:choose-course-folder",
    "davinci-free:start-batch",
    "davinci-free:retry-batch",
  ]) {
    const start = registry.indexOf(`{id:"${id}"`);
    assert.notEqual(start, -1);
    assert.match(registry.slice(start, registry.indexOf("\n", start)), /approvalMode:"step"/);
  }
});

test("lote do curso usa ordem natural, identidade compartilhada e fila persistente", async () => {
  assert.deepEqual(
    sortCourseVideoPaths([
      String.raw`Módulo 2\Aula 1.mp4`,
      String.raw`Módulo 1\Aula 10.mp4`,
      String.raw`Módulo 1\Aula 2.mp4`,
    ]),
    [
      String.raw`Módulo 1\Aula 2.mp4`,
      String.raw`Módulo 1\Aula 10.mp4`,
      String.raw`Módulo 2\Aula 1.mp4`,
    ],
  );

  const batch = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "course-batch.service.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  assert.match(batch, /course-batches/);
  assert.match(batch, /FolderBrowserDialog/);
  assert.match(batch, /powershell\.exe/);
  assert.match(batch, /reuseCourseTheme:\s*true/);
  assert.match(batch, /activeJobs/);
  assert.match(batch, /item\.status = "failed"/);
  assert.match(batch, /item\.previewPath = rendered\.previewPath/);
  assert.match(panel, /Editar curso inteiro em lote/);
  assert.match(panel, /chooseCourseFolder/);
  assert.match(panel, /const selected = await window\.kaoz1Desktop\.chooseCourseFolder/);
  assert.match(panel, /window\.setInterval/);
  assert.match(panel, /Repetir falhas/);
});

test("edição inteligente usa áudio segmentado, agente sem ferramentas e prévia renderizada", async () => {
  const analysis = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.service.ts"),
    "utf8",
  );
  const renderer = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.renderer.ts"),
    "utf8",
  );
  const design = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.design.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  const courseTheme = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "course-theme.service.ts"),
    "utf8",
  );
  assert.match(analysis, /silencedetect/);
  assert.match(analysis, /const speech = getSpeechService\(\)/);
  assert.match(analysis, /speech\.transcribe/);
  assert.match(analysis, /useExternalTools:\s*false/);
  assert.match(analysis, /deterministic-fallback/);
  assert.match(renderer, /afftdn/);
  assert.match(renderer, /acompressor/);
  assert.match(renderer, /loudnorm/);
  assert.match(renderer, /event\.x/);
  assert.match(renderer, /event\.y/);
  assert.match(renderer, /function transitionExpression/);
  assert.match(renderer, /function focalExpression/);
  assert.match(renderer, /ImpactIcon/);
  assert.match(renderer, /function impactLayouts/);
  assert.match(renderer, /resolveIntelligentEditDesign/);
  assert.match(renderer, /captionsEnabled/);
  assert.match(renderer, /preview-v4\.mp4/);
  assert.doesNotMatch(renderer, /filters\.push\(`fade=t=out/);
  assert.match(analysis, /visual-contact-sheet\.jpg/);
  assert.match(analysis, /referenceImagePath:\s*contactSheetPath/);
  assert.match(analysis, /kind:\s*"cut"/);
  assert.match(analysis, /analysisVersion:\s*6/);
  assert.match(analysis, /captionsEnabled/);
  assert.match(analysis, /courseThemeDesign/);
  assert.match(analysis, /resolveCourseTheme/);
  for (const palette of ["kaoz", "electric", "premium", "coral"]) {
    assert.match(design, new RegExp(`${palette}:`));
  }
  assert.match(panel, /Manter identidade do curso/);
  assert.match(panel, /type="checkbox"/);
  assert.match(panel, /captionsEnabled/);
  assert.match(panel, /reuseCourseTheme/);
  assert.match(courseTheme, /course-themes/);
  assert.match(courseTheme, /reused:\s*true/);
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
