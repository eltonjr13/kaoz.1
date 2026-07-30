import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sortCourseVideoPaths } from "../services/davinci-free/course-batch.order.ts";
import { chooseCourseFolder } from "../services/davinci-free/course-folder-picker.ts";
import {
  analyzeCourseIdentity,
  cleanLessonTitle,
  lessonSubtitle,
  narrativeHighlights,
} from "../services/davinci-free/course-identity.service.ts";
import {
  DEFAULT_SUBJECT_ANCHOR,
  isReliableVisualAnchor,
  stabilizeSubjectAnchor,
} from "../services/davinci-free/visual-anchor.ts";

test("ancora visual usa coordenadas locais e mantem o apresentador longe dos cantos", () => {
  const first = stabilizeSubjectAnchor({
    index: 1,
    x: 0.5,
    y: 0.4,
    confidence: 0.95,
  });
  const second = stabilizeSubjectAnchor({
    index: 2,
    x: 0.08,
    y: 0.96,
    confidence: 0.95,
  }, first);

  assert.deepEqual(first, DEFAULT_SUBJECT_ANCHOR);
  assert.equal(second.x, 0.28);
  assert.equal(second.y, 0.62);
  assert.equal(
    isReliableVisualAnchor({ index: 3, x: 0.5, y: 0.4, confidence: 0.4 }),
    false,
  );
});

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
  const picker = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "course-folder-picker.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  assert.match(batch, /course-batches/);
  assert.match(picker, /Shell\.Application/);
  assert.match(picker, /BrowseForFolder/);
  assert.match(picker, /wscript\.exe/);
  assert.equal(
    path.win32.normalize("//server/course").startsWith("\\\\"),
    true,
  );
  assert.match(picker, /const normalized = path\.win32\.normalize\(raw\)/);
  assert.match(picker, /normalized\.startsWith\("\\\\\\\\"\)/);
  assert.match(batch, /suggestedCourseName/);
  assert.match(batch, /reuseCourseTheme:\s*true/);
  assert.match(batch, /activeJobs/);
  assert.match(batch, /__kaozDavinciBatchJobs/);
  assert.match(batch, /item\.status = "failed"/);
  assert.match(batch, /item\.previewPath = rendered\.previewPath/);
  assert.match(batch, /analyzeBatchItems/);
  assert.match(batch, /resolveBatchIdentity/);
  assert.match(batch, /applyCourseIdentity/);
  assert.match(panel, /Editar curso inteiro em lote/);
  assert.match(panel, /chooseCourseFolder/);
  assert.match(panel, /const selected = await window\.kaoz1Desktop\.chooseCourseFolder/);
  assert.match(panel, /Selecionar pasta e processar/);
  assert.match(panel, /await startBatch\(folderPath, discovery\.suggestedCourseName\)/);
  assert.match(panel, /window\.setInterval/);
  assert.match(panel, /Repetir falhas/);
});

test(
  "seletor do Windows executa o script, retorna a pasta, cancela e expira com segurança",
  { skip: process.platform !== "win32" },
  async () => {
    const selectedDirectory = await mkdtemp(
      path.join(os.tmpdir(), "kaoz-course-picker-"),
    );
    const pickerDirectory = path.join(selectedDirectory, "picker-state");
    try {
      const selected = await chooseCourseFolder({
        pickerDirectory,
        runScript: async (scriptPath, resultPath) => {
          const script = await readFile(scriptPath, "utf16le");
          assert.match(script, /Shell\.Application/);
          assert.match(script, /BrowseForFolder/);
          await writeFile(resultPath, selectedDirectory, "utf16le");
        },
        responseTimeoutMs: 100,
        pollIntervalMs: 1,
      });
      assert.deepEqual(selected, {
        canceled: false,
        folderPath: path.win32.normalize(selectedDirectory),
      });

      const canceled = await chooseCourseFolder({
        pickerDirectory,
        runScript: async (_scriptPath, resultPath) => {
          await writeFile(resultPath, "CANCEL", "utf16le");
        },
        responseTimeoutMs: 100,
        pollIntervalMs: 1,
      });
      assert.deepEqual(canceled, {
        canceled: true,
        folderPath: null,
      });

      await assert.rejects(
        chooseCourseFolder({
          pickerDirectory,
          runScript: async () => undefined,
          responseTimeoutMs: 5,
          pollIntervalMs: 1,
        }),
        /expirou sem resposta/,
      );
    } finally {
      await rm(selectedDirectory, { recursive: true, force: true });
    }
  },
);

test("identidade semântica padroniza o plano de 30 dias sem duplicar aulas", async () => {
  const transcript = [{
    start: 12,
    end: 16,
    text: "A primeira semana é de limpeza e adaptação. Limpe a sua casa.",
    source: "local-asr" as const,
  }, {
    start: 42,
    end: 46,
    text: "Escolha comida de verdade e proteja os seus resultados.",
    source: "local-asr" as const,
  }];
  const identity = await analyzeCourseIdentity({
    courseName: "videos curso",
    folderName: "modulo 7",
    useAgent: false,
    lessons: [
      {
        moduleName: "1. Semana 1 limpeza e adaptação — Semana 1 limpeza e adaptação",
        transcript,
      },
      {
        moduleName: "5. Como continuar depois dos 30 dias — 5. Como continuar depois dos 30 dias",
        transcript: [{
          ...transcript[0],
          text: "Depois dos 30 dias, transforme isso em um estilo de vida.",
        }],
      },
    ],
  });
  assert.equal(identity.title, "Plano de 30 Dias");
  assert.equal(identity.eyebrow, "Módulo 7");
  assert.equal(identity.layout, "roadmap");
  assert.equal(
    identity.lessons[0].subtitle,
    "Prepare o ambiente e atravesse a fase de adaptação",
  );
  assert.equal(
    identity.lessons[1].subtitle,
    "Transforme o plano em um estilo de vida",
  );
  assert.deepEqual(
    identity.lessons.map((lesson) => lesson.title),
    ["Semana 1 · Limpeza e Adaptação", "Como Continuar Depois dos 30 Dias"],
  );
  assert.equal(
    cleanLessonTitle("2. Semana 2 consistência — Semana 2 consistência"),
    "Semana 2 · Consistência",
  );
  assert.equal(
    lessonSubtitle(
      "Semana 2 · Consistência",
      "Na primeira semana houve adaptação. Agora evite o comodismo.",
    ),
    "Transforme os primeiros resultados em consistência",
  );
  assert.deepEqual(
    narrativeHighlights(transcript, 90).map((highlight) => highlight.text),
    ["Prepare o ambiente", "Comida de verdade"],
  );
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
  assert.match(analysis, /durationSeconds \* 1_000/);
  assert.match(analysis, /const speech = getSpeechService\(\)/);
  assert.match(analysis, /speech\.transcribe/);
  assert.match(analysis, /findReusableTranscript/);
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
  assert.match(renderer, /ImpactMeta/);
  assert.match(renderer, /CardNumber/);
  assert.match(renderer, /cardProgressFilters/);
  assert.match(renderer, /cardFrameworkFilters/);
  assert.match(renderer, /cardEditorialFilters/);
  assert.match(renderer, /cardLayoutFilters/);
  assert.match(renderer, /PRÓXIMA AÇÃO/);
  assert.match(renderer, /Math\.min\(identity\.lessonIndex \+ 1/);
  assert.match(renderer, /function impactLayouts/);
  assert.match(renderer, /resolveIntelligentEditDesign/);
  assert.match(renderer, /captionsEnabled/);
  assert.match(renderer, /timeoutMs = 60 \* 60_000/);
  assert.match(renderer, /preview-v4\.mp4/);
  assert.doesNotMatch(renderer, /filters\.push\(`fade=t=out/);
  assert.match(analysis, /visual-contact-sheet\.jpg/);
  assert.match(analysis, /referenceImagePath:\s*contactSheetPath/);
  assert.match(analysis, /queryConfiguredCodexCli/);
  assert.match(analysis, /relativos somente ao painel indicado/);
  assert.match(analysis, /stabilizeSubjectAnchor/);
  assert.match(analysis, /kind:\s*"cut"/);
  assert.match(analysis, /analysisVersion:\s*7/);
  assert.match(analysis, /captionsEnabled/);
  assert.match(analysis, /courseThemeDesign/);
  assert.match(analysis, /resolveCourseTheme/);
  assert.match(analysis, /Próxima aula\\n/);
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
