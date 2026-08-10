import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sortCourseVideoPaths } from "../services/davinci-free/course-batch.order.ts";
import { runCourseBatchPool } from "../services/davinci-free/course-batch.pool.ts";
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
import { parseMediaByteRange } from "../services/davinci-free/media-range.ts";
import { createAudioWaveformPeaks } from "../services/davinci-free/audio-waveform.ts";
import {
  sanitizeEditorialPreviewPath,
  sanitizeEditorialReviewTimestamp,
} from "../services/davinci-free/editorial-review-metadata.ts";
import {
  normalizeVideoOutputResolution,
  resolveVideoOutputDimensions,
} from "../services/davinci-free/video-output-resolution.ts";
import {
  normalizeVideoEncoderPreference,
  videoEncoderArguments,
} from "../services/davinci-free/video-encoder.ts";
import { resolveLocalVideoSource } from "../services/davinci-free/video-source.ts";

test("aula única aceita uma pasta que contém exatamente um vídeo compatível", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kaoz-single-video-"));
  try {
    const videoPath = path.join(directory, "Aula 01.MP4");
    await writeFile(videoPath, "video");
    await writeFile(path.join(directory, "anotacoes.txt"), "material de apoio");

    assert.equal(await resolveLocalVideoSource(directory), path.win32.normalize(videoPath));
    assert.equal(await resolveLocalVideoSource(videoPath), path.win32.normalize(videoPath));

    const emptyDirectory = path.join(directory, "vazia");
    await mkdir(emptyDirectory);
    await assert.rejects(resolveLocalVideoSource(emptyDirectory), /não contém um vídeo compatível/);

    await writeFile(path.join(directory, "Aula 02.mp4"), "video");
    await assert.rejects(resolveLocalVideoSource(directory), /contém mais de um vídeo/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("encoder de vídeo prioriza AMD AMF e mantém fallback libx264", () => {
  assert.equal(normalizeVideoEncoderPreference(undefined), "auto");
  assert.equal(normalizeVideoEncoderPreference("cpu"), "cpu");
  assert.deepEqual(videoEncoderArguments("amd-amf").slice(0, 2), ["-c:v", "h264_amf"]);
  assert.deepEqual(videoEncoderArguments("libx264").slice(0, 2), ["-c:v", "libx264"]);
});

test("saída de vídeo usa Full HD por padrão e permite manter a resolução", () => {
  assert.equal(normalizeVideoOutputResolution(undefined), "full-hd");
  assert.equal(normalizeVideoOutputResolution("source"), "source");
  assert.deepEqual(resolveVideoOutputDimensions(3840, 2160, "full-hd"), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(resolveVideoOutputDimensions(2160, 3840, "full-hd"), {
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(resolveVideoOutputDimensions(1280, 720, "full-hd"), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(resolveVideoOutputDimensions(3840, 2160, "source"), {
    width: 3840,
    height: 2160,
  });
});

test("stream de mídia interpreta ranges usados pelo player sem carregar o arquivo inteiro", () => {
  assert.deepEqual(parseMediaByteRange(null, 1_000), null);
  assert.deepEqual(parseMediaByteRange("bytes=100-199", 1_000), {
    start: 100,
    end: 199,
  });
  assert.deepEqual(parseMediaByteRange("bytes=900-", 1_000), {
    start: 900,
    end: 999,
  });
  assert.deepEqual(parseMediaByteRange("bytes=-100", 1_000), {
    start: 900,
    end: 999,
  });
  assert.throws(() => parseMediaByteRange("bytes=1000-", 1_000), /fora do arquivo/);
});

test("waveform preserva silêncio e não achata a fala por causa de um pico isolado", () => {
  const samples = new Float32Array(10_000);
  for (let index = 2_000; index < 8_000; index += 1) {
    samples[index] = Math.sin(index / 5) * (index < 5_000 ? 0.08 : 0.18);
  }
  samples[6_050] = 1;
  const peaks = createAudioWaveformPeaks(samples, 100);
  assert.deepEqual(peaks.slice(0, 15), Array.from({ length: 15 }, () => 0));
  assert.ok(peaks.slice(20, 50).every((peak) => peak > 0.25));
  assert.ok(
    peaks.slice(50, 80).reduce((sum, peak) => sum + peak, 0)
      > peaks.slice(20, 50).reduce((sum, peak) => sum + peak, 0),
  );
  assert.equal(Math.max(...peaks), 1);
  assert.deepEqual(peaks.slice(85), Array.from({ length: 15 }, () => 0));
});

test("metadados da revisão preservam apenas prévia local segura e timestamp válido", () => {
  const artifactDirectory = path.resolve("D:", "kaoz-tests", "plan-id");
  const previewPath = path.join(artifactDirectory, "preview-v4.mp4");
  assert.equal(
    sanitizeEditorialPreviewPath(artifactDirectory, previewPath),
    previewPath,
  );
  assert.equal(
    sanitizeEditorialPreviewPath(
      artifactDirectory,
      path.join(artifactDirectory, "..", "other", "preview.mp4"),
    ),
    undefined,
  );
  assert.equal(
    sanitizeEditorialPreviewPath(
      artifactDirectory,
      path.join(artifactDirectory, "editorial-review.json"),
    ),
    undefined,
  );
  assert.equal(
    sanitizeEditorialReviewTimestamp("2026-07-30T19:25:22.756Z", "fallback"),
    "2026-07-30T19:25:22.756Z",
  );
  assert.equal(sanitizeEditorialReviewTimestamp("invalid", "fallback"), "fallback");
});

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
  const startBatch = registry.slice(
    registry.indexOf('{id:"davinci-free:start-batch"'),
    registry.indexOf("\n", registry.indexOf('{id:"davinci-free:start-batch"')),
  );
  assert.match(startBatch, /required:\["requestId","courseName"\]/);
  assert.match(startBatch, /manifestId:\{type:"string"\}/);
  assert.doesNotMatch(startBatch, /required:\[[^\]]*"folderPath"/);
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
  const picker = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "course-folder-picker.ts"),
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
  assert.match(panel, /Buscar pasta no computador/);
  assert.match(panel, /setSelectedLocalVideos/);
  assert.match(panel, /Iniciar exportação por lote/);
  assert.match(panel, /window\.setInterval/);
  assert.match(panel, /Repetir falhas/);
});

test("lote do Google Drive limita execução a duas aulas e mantém o DaVinci opcional", async () => {
  let active = 0;
  let maximum = 0;
  await runCourseBatchPool([1, 2, 3, 4, 5, 6], async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });
  assert.equal(maximum, 2);

  const batch = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "course-batch.service.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  assert.match(batch, /"downloading"/);
  assert.match(batch, /"uploading"/);
  assert.match(batch, /moduleIdentities/);
  assert.match(batch, /cancelCourseBatch/);
  assert.match(batch, /resumeCourseBatch/);
  assert.match(batch, /recoverInterruptedLegacyJob/);
  assert.match(batch, /Processamento interrompido por uma reinicialização/);
  assert.doesNotMatch(batch, /approveIntelligentEdit|createDavinciFreePlan/);
  assert.match(panel, /if \(!batchId\)/);
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
  assert.match(analysis, /reportAnalysisProgress/);
  assert.match(analysis, /Transcrevendo áudio:/);
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
  assert.match(renderer, /ensureSfxLibrary/);
  assert.match(renderer, /adelay/);
  assert.match(renderer, /Promise\.allSettled/);
  assert.match(renderer, /"-c:v", "copy"/);
  assert.match(renderer, /selectVideoEncoder/);
  assert.doesNotMatch(renderer, /\[vbase\]/);
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
  assert.match(panel, /processingProgress/);
  assert.match(panel, /lg:col-span-6 lg:col-start-4/);
  assert.match(courseTheme, /course-themes/);
  assert.match(courseTheme, /reused:\s*true/);
});

test("revisão editorial preserva o plano automático e reaplica apenas regras seguras ao curso", async () => {
  const review = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.review.ts"),
    "utf8",
  );
  const renderer = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.renderer.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  assert.match(review, /editorial-review\.json/);
  assert.match(review, /applyEditorialReview/);
  assert.match(review, /enabledKinds/);
  assert.match(review, /zoomScale/);
  assert.match(review, /recordEditorialPreview/);
  assert.match(review, /addedEvents/);
  assert.match(review, /custom-evt-/);
  assert.match(renderer, /recordEditorialPreview/);
  assert.match(panel, /Timeline editorial/);
  assert.match(panel, /Salvar padrão do curso/);
  assert.match(panel, /Exibir legendas/);
  assert.match(panel, /Restaurar automático/);
  assert.match(panel, /api\/davinci-free\/media/);
  assert.match(panel, /musicWaveform/);
  assert.match(panel, /addedEvents/);
  assert.match(panel, /grid flex-1 min-h-0 items-stretch gap-0/);
  assert.match(panel, /lg:h-\[calc\(100vh-140px\)\]/);
  assert.match(panel, /lg:min-h-0/);
  assert.match(panel, /min-h-\[180px\] flex-1 overflow-hidden border-t/);
  assert.match(panel, /fillAvailableHeight/);
  assert.match(panel, /fixed inset-x-0 bottom-0/);
  assert.match(panel, /activeMode === "batch"/);
  assert.doesNotMatch(panel, /min-h-\[640px\]/);
  assert.doesNotMatch(panel, /handlePlayerSeek/);
  assert.doesNotMatch(panel, /Controls Overlay/);
  assert.match(panel, /title=\{isPlaying \? "Pausar" : "Reproduzir"\}/);
  assert.ok(
    panel.indexOf("timelineScale * 100")
      < panel.indexOf('title={isPlaying ? "Pausar" : "Reproduzir"}'),
  );
  assert.match(panel, /grid-cols-\[40px_minmax\(0,1fr\)\]/);
  assert.match(panel, /left-\[52px\] right-3/);
  assert.match(panel, /tick \/ timelineDuration/);
});

test("edição de vídeo possui área própria na navegação, fora das configurações", async () => {
  const shell = await readFile(path.join(process.cwd(), "components", "layout", "app-shell.tsx"), "utf8");
  const page = await readFile(path.join(process.cwd(), "app", "(dashboard)", "video", "page.tsx"), "utf8");
  const editor = await readFile(path.join(process.cwd(), "components", "video", "video-editor-client.tsx"), "utf8");
  const settings = await readFile(path.join(process.cwd(), "app", "(dashboard)", "settings", "page.tsx"), "utf8");
  assert.match(shell, /href: "\/video"/);
  assert.match(shell, /Edição de vídeo/);
  assert.match(page, /VideoEditorClient/);
  assert.match(editor, /DavinciFreePanel/);
  assert.doesNotMatch(settings, /DavinciFreePanel/);
  assert.doesNotMatch(settings, /davinci-free/);
});

test("backend de mídia expõe streaming parcial e waveform real para o editor", async () => {
  const mediaRoute = await readFile(
    path.join(process.cwd(), "app", "api", "davinci-free", "media", "route.ts"),
    "utf8",
  );
  const mediaService = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.media.ts"),
    "utf8",
  );
  assert.match(mediaRoute, /Accept-Ranges/);
  assert.match(mediaRoute, /Content-Range/);
  assert.match(mediaRoute, /readIntelligentAudioWaveform/);
  assert.match(mediaService, /waveform-/);
  assert.match(mediaService, /"-ar",\s*"200"/);
  assert.match(mediaService, /waveform-.*-v2\.json/);
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

test("lote de vídeos suporta filtragem por seleção prévia e pasta de download customizada", async () => {
  const batchService = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "course-batch.service.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  const driveService = await readFile(
    path.join(process.cwd(), "services", "google-drive", "google-drive.service.ts"),
    "utf8",
  );
  assert.match(batchService, /selectedItemIds/);
  assert.match(batchService, /selectedRelativePaths/);
  assert.match(batchService, /downloadFolder/);
  assert.match(batchService, /localLessonDirectory/);
  assert.match(batchService, /Nenhuma aula selecionada para processar/);
  assert.match(batchService, /Nenhum vídeo selecionado para processar/);
  assert.match(panel, /Pasta de Download e Processamento Local/);
  assert.match(panel, /chooseDownloadFolder/);
  assert.match(driveService, /customDownloadFolder/);
  assert.match(driveService, /path\.isAbsolute\(resolved\)/);
});
