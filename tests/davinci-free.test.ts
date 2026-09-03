import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
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
  detectSilenceRanges,
  editedVideoDuration,
  editedVideoTime,
  findActiveClipAtTime,
  nextPlayheadAfterCuts,
  sourceVideoTime,
  videoActiveClips,
  videoCutRanges,
  videoCutSelectExpression,
} from "../services/davinci-free/video-cuts.ts";
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
import {
  formattedLessonNumber,
  lessonDownloadFileName,
} from "../services/davinci-free/lesson-download.ts";
import {
  analyzePedagogicalTranscript,
  buildPedagogicalTranscriptChunks,
  consolidatePedagogicalItems,
} from "../services/davinci-free/pedagogical-analysis.ts";
import {
  composeMotionEvents,
  defaultMotionPace,
  resolveMotionProfile,
} from "../services/davinci-free/intelligent-edit.motion.ts";
import { karaokeCaptionSlices, karaokeWordState } from "../services/davinci-free/caption-karaoke.ts";
import { fastVideoFingerprint } from "../services/davinci-free/video-source.ts";
import {
  estimateVideoExportBytes,
  normalizeVideoExportProfile,
  resolveVideoExportProfile,
  shouldCreateVideoProxy,
} from "../services/davinci-free/video-export-profile.ts";
import { createVideoSourceFingerprint } from "../services/davinci-free/video-source-fingerprint.ts";
import { motionRampTiming, transitionEnvelope } from "../services/davinci-free/video-motion-curves.ts";
import { cleanupVideoRenderPartials, pruneVideoRenderCache } from "../services/davinci-free/video-render-cache.ts";
import {
  latestCompletedExportJob,
  renderedPreviewSelection,
} from "../services/davinci-free/video-preview-state.ts";
import {
  INTELLIGENT_CAPTION_PRESETS,
  isIntelligentCaptionPreset,
  isKaraokeCaptionPreset,
} from "../services/davinci-free/intelligent-edit.types.ts";
import type {
  IntelligentEditEvent,
  IntelligentPedagogicalItem,
  TimedTranscriptSegment,
} from "../services/davinci-free/intelligent-edit.types.ts";

test("presets de movimento mantêm ritmo legível em todos os estilos", () => {
  assert.equal(defaultMotionPace("subtle"), "calm");
  assert.equal(defaultMotionPace("balanced"), "natural");
  assert.equal(defaultMotionPace("dynamic"), "energetic");
  const calm = resolveMotionProfile("calm", "balanced");
  const natural = resolveMotionProfile("natural", "balanced");
  const energetic = resolveMotionProfile("energetic", "dynamic");
  assert.ok(calm.zoomDuration > natural.zoomDuration);
  assert.ok(natural.zoomDuration > energetic.zoomDuration);
  assert.ok(energetic.zoomDuration >= 2.4);
  assert.ok(calm.transitionDuration >= 0.9);
  assert.ok(energetic.transitionDuration >= 0.65);
  assert.equal(calm.cardDuration, 4);
});

test("karaokê destaca somente a palavra ativa em cada intervalo real", () => {
  const slices = karaokeCaptionSlices(
    {
      start: 2,
      end: 3.5,
      text: "Uma ideia forte",
      words: [
        { text: "Uma", start: 2.1, end: 2.4 },
        { text: "ideia", start: 2.4, end: 3 },
        { text: "forte", start: 3, end: 3.4 },
      ],
    },
  );

  assert.deepEqual(slices.map(({ start, end, activeIndex, completedIndex }) => ({ start, end, activeIndex, completedIndex })), [
    { start: 2, end: 2.1, activeIndex: -1, completedIndex: -1 },
    { start: 2.1, end: 2.4, activeIndex: 0, completedIndex: -1 },
    { start: 2.4, end: 3, activeIndex: 1, completedIndex: 0 },
    { start: 3, end: 3.4, activeIndex: 2, completedIndex: 1 },
    { start: 3.4, end: 3.5, activeIndex: -1, completedIndex: 2 },
  ]);
  assert.deepEqual(slices[2].words, ["Uma", "ideia", "forte"]);
  assert.deepEqual(karaokeWordState({
    start: 2,
    end: 3.5,
    text: "Uma ideia forte",
    words: [
      { text: "Uma", start: 2.1, end: 2.3 },
      { text: "ideia", start: 2.5, end: 2.9 },
      { text: "forte", start: 3.1, end: 3.4 },
    ],
  }, 2.4), { activeIndex: -1, completedIndex: 0 });
  assert.deepEqual(INTELLIGENT_CAPTION_PRESETS.filter(isKaraokeCaptionPreset), [
    "karaoke",
    "karaoke-fill",
    "karaoke-pop",
    "karaoke-neon",
    "karaoke-box",
  ]);
  assert.equal(isIntelligentCaptionPreset("karaoke-neon"), true);
  assert.equal(isIntelligentCaptionPreset("karaoke-inexistente"), false);
});

test("composição de movimento separa efeitos concorrentes sem perder eventos", () => {
  const profile = resolveMotionProfile("natural", "balanced");
  const events: IntelligentEditEvent[] = [
    { id: "zoom", kind: "zoom", start: 10, duration: profile.zoomDuration, label: "Zoom", reason: "teste" },
    { id: "impact", kind: "impact-text", start: 10, duration: profile.impactDuration, label: "Texto", reason: "teste" },
    { id: "lower", kind: "lower-third", start: 10.1, duration: profile.lowerThirdDuration, label: "Tarja", reason: "teste" },
    { id: "transition-a", kind: "transition", start: 20, duration: profile.transitionDuration, label: "A", reason: "teste" },
    { id: "transition-b", kind: "transition", start: 20.2, duration: profile.transitionDuration, label: "B", reason: "teste" },
  ];
  const composed = composeMotionEvents(events, 60, profile);
  const impact = composed.find((event) => event.id === "impact")!;
  const lower = composed.find((event) => event.id === "lower")!;
  const transitions = composed.filter((event) => event.kind === "transition");
  assert.ok(impact.start > 10);
  assert.ok(lower.start >= impact.start + impact.duration + profile.minimumStrongEffectGap);
  assert.ok(transitions[1].start - transitions[0].start >= profile.minimumStrongEffectGap);
  assert.equal(composed.length, events.length);
});

test("análise pedagógica divide aulas longas sem perder o final da transcrição", async () => {
  const segments: TimedTranscriptSegment[] = Array.from({ length: 36 }, (_, index) => ({
    start: index * 5,
    end: index * 5 + 4.5,
    text: `${index === 35 ? "MARCADOR_FINAL " : ""}${`conteúdo pedagógico ${index} `.repeat(16)}`,
    source: "local-asr" as const,
  }));
  const chunks = buildPedagogicalTranscriptChunks(segments, 1_200);
  const prompts: string[] = [];
  const analysis = await analyzePedagogicalTranscript({
    segments,
    courseName: "Curso completo",
    moduleName: "Aula longa",
    useAgent: true,
    maxChunkCharacters: 1_200,
    queryAgent: async (prompt) => {
      prompts.push(prompt);
      const index = prompts.length;
      return JSON.stringify({
        items: [{
          kind: "chapter",
          title: `Bloco ${index}`,
          start: 0,
          end: 999_999,
          evidence: `Evidência ${index}`,
          importance: "medium",
          confidence: 0.9,
          editorialSuggestion: "Criar marcador de capítulo.",
        }],
      });
    },
  });

  assert.ok(chunks.length > 1);
  assert.equal(analysis.version, 2);
  assert.equal(analysis.chunkCount, chunks.length);
  assert.equal(analysis.segmentsAnalyzed, segments.length);
  assert.equal(
    analysis.analyzedCharacters,
    segments.reduce((sum, segment) => sum + segment.text.length, 0),
  );
  assert.equal(prompts.length, chunks.length);
  assert.match(prompts.at(-1) || "", /MARCADOR_FINAL/);
  assert.equal(analysis.source, "agent");
  assert.ok(analysis.items.every((item) => item.status === "suggested"));
  assert.ok(analysis.items.every((item) => !item.evidence.startsWith("Evidência")));
  assert.ok(analysis.items.every((item) => item.start >= 0 && item.end <= segments.at(-1)!.end));
});

test("fallback pedagógico conserva evidência temporal e identifica estrutura de curso", async () => {
  const segments: TimedTranscriptSegment[] = [
    { start: 0, end: 4, text: "Nesta aula vamos configurar seu primeiro projeto.", source: "local-asr" },
    { start: 5, end: 9, text: "Primeiro passo: abra as configurações.", source: "local-asr" },
    { start: 10, end: 14, text: "Por exemplo, use o projeto de demonstração.", source: "local-asr" },
    { start: 15, end: 19, text: "Cuidado: não apague a configuração original.", source: "local-asr" },
    { start: 20, end: 24, text: "Como exercício, pratique com uma cópia.", source: "local-asr" },
    { start: 25, end: 29, text: "Em resumo, o projeto está pronto para a próxima aula.", source: "local-asr" },
  ];
  const analysis = await analyzePedagogicalTranscript({
    segments,
    moduleName: "Configuração inicial",
    useAgent: false,
  });
  const kinds = new Set(analysis.items.map((item) => item.kind));

  assert.equal(analysis.source, "deterministic-fallback");
  for (const kind of ["objective", "process-step", "example", "warning", "exercise", "summary", "next-link"]) {
    assert.ok(kinds.has(kind as IntelligentPedagogicalItem["kind"]), `item ausente: ${kind}`);
  }
  assert.ok(analysis.items.every((item) => item.evidence.length > 0));
  assert.ok(analysis.items.every((item) => item.start <= item.end));
});

test("consolidação pedagógica remove duplicatas mantendo a sugestão mais confiante", () => {
  const base: IntelligentPedagogicalItem = {
    id: "original",
    kind: "concept",
    title: "Funil de vendas",
    start: 12,
    end: 16,
    evidence: "Um funil de vendas organiza as etapas.",
    importance: "medium",
    confidence: 0.6,
    editorialSuggestion: "Registrar o conceito.",
    status: "suggested",
    source: "chunk-fallback",
  };
  const consolidated = consolidatePedagogicalItems([
    base,
    { ...base, id: "duplicate", start: 13, confidence: 0.95, source: "chunk-agent" },
  ]);

  assert.equal(consolidated.length, 1);
  assert.equal(consolidated[0].confidence, 0.95);
  assert.equal(consolidated[0].source, "chunk-agent");
});

test("download da aula usa número, nome temático e arquivo TXT da transcrição", () => {
  const identity = {
    moduleName: "Módulo 2",
    lessonNumber: "7",
    lessonName: "Construindo uma oferta irresistível",
  };
  assert.equal(formattedLessonNumber(identity.lessonNumber), "07");
  assert.equal(
    lessonDownloadFileName(identity, "video"),
    "07 - Construindo uma oferta irresistível.mp4",
  );
  assert.equal(
    lessonDownloadFileName(identity, "transcript"),
    "07 - Construindo uma oferta irresistível - transcrição.txt",
  );
});

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

test("cortes manuais unem intervalos e recalculam duração e tempo editado", () => {
  const events = [
    { id: "a", kind: "remove", start: 0, duration: 3, label: "início", reason: "manual" },
    { id: "b", kind: "remove", start: 2.5, duration: 2, label: "silêncio", reason: "manual" },
    { id: "c", kind: "zoom", start: 8, duration: 1, label: "zoom", reason: "automático" },
  ] as const;
  assert.deepEqual(videoCutRanges([...events], 10), [{ start: 0, end: 4.5 }]);
  assert.equal(editedVideoDuration([...events], 10), 5.5);
  assert.equal(editedVideoTime([...events], 10, 8), 3.5);
  assert.equal(videoCutSelectExpression([...events], 10), "not(between(t,0.000,4.500))");
  // Total preview duration is edited duration + 8s (4s intro + 4s outro)
  const previewDuration = editedVideoDuration([...events], 10) + 8;
  assert.equal(previewDuration, 13.5);
  // Event at 8s in source time occurs at 3.5s in edited body + 4s intro = 7.5s in preview video
  assert.equal(editedVideoTime([...events], 10, 8) + 4, 7.5);
});

test("tempo da prévia limpa volta ao timestamp original para sincronizar a legenda ao vivo", () => {
  const events: IntelligentEditEvent[] = [
    { id: "remove-1", kind: "remove", start: 4, duration: 2, label: "Corte", reason: "teste" },
    { id: "remove-2", kind: "remove", start: 10, duration: 1, label: "Corte", reason: "teste" },
  ];
  assert.equal(sourceVideoTime(events, 20, editedVideoTime(events, 20, 3)), 3);
  assert.equal(sourceVideoTime(events, 20, editedVideoTime(events, 20, 8)), 8);
  assert.equal(sourceVideoTime(events, 20, editedVideoTime(events, 20, 15)), 15);
});

test("fatiamento em clipes ativos, detecção de silêncio e pulo de corte em tempo real", () => {
  const events = [
    { id: "c1", kind: "remove" as const, start: 5, duration: 3, label: "pausa 1", reason: "corte" },
    { id: "c2", kind: "remove" as const, start: 12, duration: 2, label: "pausa 2", reason: "corte" },
  ];
  const clips = videoActiveClips(events, 20);
  assert.equal(clips.length, 3);
  assert.deepEqual(clips[0], { id: "clip-0", index: 0, start: 0, end: 5, duration: 5 });
  assert.deepEqual(clips[1], { id: "clip-1", index: 1, start: 8, end: 12, duration: 4 });
  assert.deepEqual(clips[2], { id: "clip-2", index: 2, start: 14, end: 20, duration: 6 });

  const clipAt7 = findActiveClipAtTime(clips, 7);
  assert.equal(clipAt7?.id, "clip-1");
  const clipAt10 = findActiveClipAtTime(clips, 10);
  assert.equal(clipAt10?.id, "clip-1");

  // Live cut skipping
  const skipDuringCut = nextPlayheadAfterCuts(6, [{ start: 5, end: 8 }]);
  assert.equal(skipDuringCut.jumped, true);
  assert.equal(skipDuringCut.newTime, 8);

  const skipOutsideCut = nextPlayheadAfterCuts(9, [{ start: 5, end: 8 }]);
  assert.equal(skipOutsideCut.jumped, false);
  assert.equal(skipOutsideCut.newTime, 9);

  // Silence detection from waveform peaks (normalized 0..1)
  // 20 points for 20 seconds (1s per point). Points 4, 5, 6, 7 are 0 (silent)
  const peaks = [0.8, 0.9, 0.7, 0.5, 0.01, 0.01, 0.01, 0.01, 0.6, 0.8, 0.9, 0.7, 0.6, 0.5, 0.6, 0.7, 0.8, 0.7, 0.6, 0.5];
  const silences = detectSilenceRanges(peaks, 20, { minSilenceDuration: 0.5, threshold: 0.04, padding: 0.05 });
  assert.ok(silences.length >= 1);
  assert.ok(silences[0].start >= 4 && silences[0].end <= 8);
});

test("régua da timeline evita sobreposição de marcas quando o último segundo está próximo do passo", () => {
  function generateRulerTicks(duration: number, scale = 1) {
    const ticks: number[] = [];
    const visibleDuration = duration / scale;
    const step = visibleDuration > 300 ? 60 : visibleDuration > 120 ? 30 : visibleDuration > 60 ? 15 : 5;
    for (let i = 0; i <= duration; i += step) {
      ticks.push(i);
    }
    const lastWholeSecond = Math.floor(duration);
    if (ticks.length > 0) {
      const lastTick = ticks[ticks.length - 1];
      if (lastWholeSecond - lastTick >= step * 0.6) {
        ticks.push(lastWholeSecond);
      }
    } else {
      ticks.push(0);
    }
    return ticks;
  }

  // Duration 47.4s with step 5 should NOT include 47 directly next to 45 (which caused 0:450:47 collision)
  const ticks47 = generateRulerTicks(47.4);
  assert.deepEqual(ticks47, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);

  // Duration 48.5s (48 - 45 = 3 >= 5 * 0.6 = 3) safely includes 48
  const ticks48 = generateRulerTicks(48.5);
  assert.deepEqual(ticks48, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 48]);
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
  assert.match(batch, /item\.previewPath = await renderBatchPlan/);
  assert.match(batch, /startVideoRenderJob/);
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
  const webSpeechMedia = await readFile(
    path.join(process.cwd(), "lib", "speech", "web-speech-media.ts"),
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
  assert.match(analysis, /webSpeechTranscriptSegments/);
  assert.match(analysis, /backend: "web" as const/);
  assert.match(analysis, /input\.transcriptionMode === "cloud" \? "cloud" : "configured"/);
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
  assert.match(renderer, /const zoomEvents = events\.filter\(\(event\) => event\.kind === "zoom"\)/);
  assert.match(renderer, /for \(const event of \[\.\.\.candidates, \.\.\.zoomEvents\]\.reverse\(\)\)/);
  assert.match(renderer, /3-2\*\(/);
  assert.match(renderer, /transitionDarkness/);
  assert.doesNotMatch(renderer, /-0\.95\*/);
  assert.match(renderer, /ImpactBox/);
  assert.match(renderer, /ImpactIcon/);
  assert.match(renderer, /ImpactMeta/);
  assert.match(renderer, /CardNumber/);
  assert.match(renderer, /formattedLessonNumber\(plan\.lessonNumber\)/);
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
  assert.doesNotMatch(renderer, /Promise\.allSettled/);
  assert.match(renderer, /renderCachedBodyChunks/);
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
  assert.match(analysis, /analysisVersion:\s*12/);
  assert.match(analysis, /analyzePedagogicalTranscript/);
  assert.match(analysis, /pedagogical-analysis\.json/);
  assert.match(analysis, /transcript\.txt/);
  assert.match(analysis, /toPlainTranscript/);
  assert.match(analysis, /pedagogyPath/);
  assert.match(analysis, /captionsEnabled/);
  assert.match(analysis, /courseThemeDesign/);
  assert.match(analysis, /resolveCourseTheme/);
  assert.match(analysis, /Próxima aula\\n/);
  for (const palette of ["kaoz", "electric", "premium", "coral"]) {
    assert.match(design, new RegExp(`${palette}:`));
  }
  assert.match(panel, /Manter identidade do curso/);
  assert.match(panel, /Nº da aula/);
  assert.match(panel, /Nome da aula/);
  assert.match(panel, /Ritmo das animações/);
  assert.match(panel, /updateMotionPace/);
  assert.match(panel, /asset=transcript&download=true/);
  assert.match(panel, /Download do vídeo e da transcrição TXT iniciado/);
  assert.match(panel, /type="checkbox"/);
  assert.match(panel, /captionsEnabled/);
  assert.match(panel, /reuseCourseTheme/);
  assert.match(panel, /Web Speech · navegador sem chave/);
  assert.match(panel, /API · OpenAI ou Gemini configurada/);
  assert.match(panel, /transcribeMediaWithWebSpeech/);
  assert.match(panel, /transcriptionSegments/);
  assert.match(panel, /disabled=\{!isDesktopRuntime\}/);
  assert.match(panel, /transcriptionModelId: transcriptionMode === "local" \? form\.transcriptionModelId : undefined/);
  assert.match(webSpeechMedia, /recognition\.start\(audioTrack\)/);
  assert.match(webSpeechMedia, /createMediaStreamDestination/);
  assert.match(webSpeechMedia, /RECOGNITION_WINDOW_MS = 6_000/);
  assert.match(webSpeechMedia, /recognition\.interimResults = true/);
  assert.match(webSpeechMedia, /audio\.pause\(\);\s*recognition\.stop\(\)/);
  assert.match(webSpeechMedia, /appendSegment\(recognitionStart, audio\.currentTime/);
  assert.match(webSpeechMedia, /O Web Speech terminou sem retornar texto/);
  assert.match(panel, /processingProgress/);
  assert.match(panel, /lg:col-span-6 lg:col-start-4/);
  assert.match(courseTheme, /course-themes/);
  assert.match(courseTheme, /reused:\s*true/);
});

test("progresso de análise e renderização ignora a fila serial de ferramentas", async () => {
  const route = await readFile(
    path.join(process.cwd(), "app", "api", "davinci-free", "route.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  const progressBranch = route.indexOf('searchParams.get("progress") === "1"');
  const queuedStatusRead = route.indexOf('await execute("status", {})');

  assert.notEqual(progressBranch, -1);
  assert.notEqual(queuedStatusRead, -1);
  assert.ok(
    progressBranch < queuedStatusRead,
    "a resposta de progresso deve acontecer antes da leitura que entra na mailbox serial",
  );
  assert.match(route, /Promise\.all\(\[\s*readIntelligentAnalysisStatus\(\),\s*readIntelligentRenderStatus\(\)/);
  assert.match(panel, /fetch\("\/api\/davinci-free\?progress=1"/);
  assert.match(panel, /refreshProgress\(\)\.catch\(\(\) => undefined\)/);
});

test("SFX imersivos usam os nove áudios reais e decisões semânticas da IA", async () => {
  const analysis = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.service.ts"),
    "utf8",
  );
  const renderer = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.renderer.ts"),
    "utf8",
  );
  const library = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "sfx.service.ts"),
    "utf8",
  );
  const batch = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "course-batch.service.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );
  const expectedAssets = [
    "interface-click.mp3",
    "keyboard-typing.mp3",
    "light-impact.mp3",
    "page-flip.mp3",
    "positive-confirmation.mp3",
    "rising-swoosh.mp3",
    "soft-error.mp3",
    "soft-whoosh.mp3",
    "subtle-pop.mp3",
  ];
  const actualAssets = (await readdir(path.join(process.cwd(), "public", "sfx")))
    .filter((name) => name.endsWith(".mp3"))
    .sort();
  assert.deepEqual(actualAssets, expectedAssets);
  for (const asset of expectedAssets) {
    const audio = await readFile(path.join(process.cwd(), "public", "sfx", asset));
    assert.ok(audio.length > 20_000, `${asset} deve conter o áudio real, não um placeholder`);
  }
  assert.match(analysis, /"soundEffects"/);
  assert.match(analysis, /nunca use som ambiente/);
  assert.match(analysis, /kind: "sound-effect"/);
  assert.match(analysis, /analysisVersion: 12/);
  assert.match(analysis, /sfxEnabled: input\.sfxEnabled/);
  assert.match(analysis, /sfxPack: input\.sfxPack/);
  assert.match(renderer, /event\.soundEffect/);
  assert.match(renderer, /event\.soundEffectGainDb/);
  assert.match(renderer, /hasSemanticSfx/);
  assert.match(library, /Pacote de SFX imersivos incompleto/);
  assert.match(batch, /sfxEnabled: job\.sfxEnabled/);
  assert.match(batch, /sfxPack: job\.sfxPack/);
  assert.match(panel, /A IA escolhe entre 9 sons reais/);
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
  assert.match(review, /eventDurations/);
  assert.match(review, /motionPace/);
  assert.match(review, /shouldApplyMotionProfile/);
  assert.match(review, /composeMotionEvents/);
  assert.match(review, /recordEditorialPreview/);
  assert.match(review, /addedEvents/);
  assert.match(review, /pedagogicalOverrideEntry/);
  assert.match(review, /status:\s*change\.status/);
  assert.match(review, /custom-evt-/);
  assert.match(renderer, /recordEditorialPreview/);
  assert.match(panel, /Timeline editorial/);
  assert.match(panel, /Salvar padrão do curso/);
  assert.match(panel, /Exibir legendas/);
  assert.match(panel, /Track SUB \(Legendas\)/);
  assert.match(panel, /aria-pressed=\{captionsEnabled\}/);
  assert.match(panel, /updateCaptionsEnabled\(!captionsEnabled\)/);
  assert.match(panel, /timeline-caption-/);
  assert.match(panel, /activeMediaAsset === "source" \|\| hasLiveCaptionPreview/);
  assert.match(panel, /sourceVideoTime\(analysis\.events, analysis\.media\.durationSeconds, bodyTime\)/);
  assert.match(panel, /action\("start-spot-preview"/);
  assert.match(panel, /action: "start-proxy"/);
  assert.match(panel, /Alterações salvas automaticamente/);
  assert.match(renderer, /renderMode === "live-preview"/);
  assert.match(renderer, /live-preview-v1\.mp4/);
  assert.match(renderer, /const renderMode = rawInput\.renderMode/);
  assert.match(renderer, /finalPath/);
  assert.match(review, /review\.captionPreset/);
  assert.match(panel, /editedVideoTime\(analysis\.events, rawDuration, sourceStart\) \+ 4/);
  assert.match(panel, /justify-start gap-0\.5 pl-2 font-mono text-\[9px\]/);
  assert.match(panel, /Restaurar automático/);
  assert.match(panel, /api\/davinci-free\/media/);
  assert.match(panel, /musicWaveform/);
  assert.match(panel, /addedEvents/);
  assert.match(panel, /grid flex-none items-stretch gap-0/);
  assert.match(panel, /lg:h-\[980px\]/);
  assert.match(panel, /leftPanelCollapsed/);
  assert.match(panel, /rightPanelCollapsed/);
  assert.match(panel, /Retrair painel de configuração/);
  assert.match(panel, /Retrair AI Inspector/);
  assert.match(panel, /lg:col-span-10/);
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
  assert.match(renderer, /sidechaincompress/);
  assert.match(renderer, /highpass=f=80/);
  assert.match(panel, /Auto-Ducking Inteligente/);
  assert.match(panel, /Studio Voice Enhancer/);
  assert.match(panel, /snapGuideTime/);
  assert.match(renderer, /CaptionHormozi/);
  assert.match(renderer, /CaptionKaraoke/);
  assert.match(renderer, /CaptionKaraokeFill/);
  assert.match(renderer, /CaptionKaraokePop/);
  assert.match(renderer, /CaptionKaraokeNeon/);
  assert.match(renderer, /CaptionKaraokeBox/);
  assert.match(renderer, /karaokeCaptionSlices/);
  assert.match(renderer, /karaokeStyleName/);
  assert.match(renderer, /CaptionClean/);
  assert.match(renderer, /CaptionNeon/);
  assert.match(renderer, /CaptionBoxed/);
  assert.match(renderer, /CaptionOutline/);
  assert.match(renderer, /CaptionHighlight/);
  assert.match(panel, /Estilo das Legendas/);
  assert.match(panel, /Prévia dos estilos de legenda/);
  assert.match(panel, /CAPTION_PRESET_OPTIONS\.map/);
  assert.match(panel, /captionPresetPickerOpen/);
  assert.match(panel, /aria-expanded=\{captionPresetPickerOpen\}/);
  assert.match(panel, /setCaptionPresetPickerOpen\(false\)/);
  assert.match(panel, /activeWordIndex=\{currentKaraokeWordState\?\.activeIndex\}/);
  assert.match(panel, /completedWordIndex=\{currentKaraokeWordState\?\.completedIndex\}/);
  assert.match(panel, /Karaokê Fill/);
  assert.match(panel, /Karaokê Pop/);
  assert.match(panel, /Karaokê Neon/);
  assert.match(panel, /Karaokê Caixa/);
  assert.match(panel, /Neon Tech/);
  assert.match(panel, /Caixa/);
  assert.match(panel, /Contorno/);
  assert.match(panel, /Destaque/);
  assert.match(panel, /Sumário & Capítulos/);
  assert.match(panel, /hoverTime/);
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
  assert.match(editor, /min-h-0 flex-1 overflow-y-auto/);
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
  assert.match(mediaRoute, /"transcript"/);
  assert.match(mediaService, /waveform-/);
  assert.match(mediaService, /lessonDownloadFileName/);
  assert.match(mediaService, /transcriptTextPath/);
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

test("limpeza de cache do editor remove estado persistido, waveforms, uploads e previne interferência entre vídeos", async () => {
  const service = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.service.ts"),
    "utf8",
  );
  const registry = await readFile(
    path.join(process.cwd(), "services", "tools", "tool.registry.ts"),
    "utf8",
  );
  const adapter = await readFile(
    path.join(process.cwd(), "services", "orchestrator", "adapters", "content.adapter.ts"),
    "utf8",
  );
  const route = await readFile(
    path.join(process.cwd(), "app", "api", "davinci-free", "route.ts"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"),
    "utf8",
  );

  assert.match(service, /clearVideoEditorCache/);
  assert.match(service, /latest-analysis\.json/);
  assert.match(service, /analysis-status\.json/);
  assert.match(service, /render-status\.json/);
  assert.match(service, /pending-plan\.json/);
  assert.match(service, /source-waveforms/);
  assert.match(service, /web-uploads/);

  assert.match(registry, /"davinci-free:clear-cache"/);
  assert.match(adapter, /"davinci-free:clear-cache"/);
  assert.match(route, /"clear-cache": "davinci-free:clear-cache"/);

  assert.match(panel, /clearEditorCache/);
  assert.match(panel, /showClearCacheModal/);
  assert.match(panel, /initialAnalysisLoadedRef/);
  assert.match(panel, /Limpar Cache/);
});

test("fastVideoFingerprint gera hash determinístico e suporta arquivos pequenos e grandes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kaoz-fp-test-"));
  try {
    const fileA = path.join(dir, "video-sample.mp4");
    await writeFile(fileA, Buffer.alloc(1024 * 64, 42));
    const hash1 = await fastVideoFingerprint(fileA);
    const hash2 = await fastVideoFingerprint(fileA);
    assert.equal(hash1, hash2);
    assert.equal(typeof hash1, "string");
    assert.equal(hash1.length, 64);

    const fileB = path.join(dir, "different.mp4");
    await writeFile(fileB, Buffer.alloc(1024 * 64, 99));
    const hashB = await fastVideoFingerprint(fileB);
    assert.notEqual(hash1, hashB);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pipeline de análise usa âncora visual estabilizada real, cortes de silêncio e transcrição otimizada", async () => {
  const service = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.service.ts"),
    "utf8",
  );
  const whisper = await readFile(
    path.join(process.cwd(), "services", "speech", "speech-whisper-cpp-runtime.ts"),
    "utf8",
  );
  const pedagogy = await readFile(
    path.join(process.cwd(), "services", "davinci-free", "pedagogical-analysis.ts"),
    "utf8",
  );

  // Verifies that face tracking doesn't reset target coordinates to 0.5
  assert.match(service, /target\.x\s*=\s*previousSubjectAnchor\.x/);
  assert.match(service, /target\.y\s*=\s*previousSubjectAnchor\.y/);
  // Verifies parallel frame extraction
  assert.match(service, /Promise\.all\(\s*paddedEvents\.map/);

  // Verifies master audio extraction, WAV copy codec, and concurrency >= 3
  assert.match(service, /extractMasterAudio/);
  assert.match(service, /CONCURRENCY\s*=\s*3/);
  assert.match(service, /"-c:a",\s*"copy"/);
  assert.match(service, /fastVideoFingerprint/);

  // Verifies decoupled transcript caching
  assert.match(service, /TRANSCRIPTS_DIR/);
  assert.match(service, /saveTranscriptCache/);

  // Verifies automatic silence cutting
  assert.match(service, /autoCutSilences/);
  assert.match(service, /silenceCutThresholdSeconds/);
  assert.match(service, /silence-cut/);
  assert.match(service, /Corte de silêncio/);

  // Verifies Whisper PCM 16k mono fast path
  assert.match(whisper, /isPcm16kMonoWav/);

  // Verifies pedagogical analysis concurrency
  assert.match(pedagogy, /Promise\.all\(\s*chunks\.map/);
});

test("perfil de exportação limita resolução e FPS à fonte sem upscale", () => {
  const landscape = resolveVideoExportProfile({ resolution: "2k", fps: 60, bitrateMode: "recommended" }, {
    width: 1920,
    height: 1080,
    fps: 29.97,
  });
  assert.equal(landscape.width, 1920);
  assert.equal(landscape.height, 1080);
  assert.equal(landscape.fps, 24);
  assert.equal(landscape.bitrateKbps, 14_000);
  assert.equal(landscape.sourceLimitedResolution, true);
  assert.equal(landscape.sourceLimitedFps, true);

  const portrait = resolveVideoExportProfile({ resolution: "720p", fps: 30, bitrateMode: "high" }, {
    width: 1080,
    height: 1920,
    fps: 60,
  });
  assert.deepEqual([portrait.width, portrait.height, portrait.fps], [720, 1280, 30]);
  assert.equal(portrait.bitrateKbps, 6_000);

  const custom = normalizeVideoExportProfile({ resolution: "1080p", fps: 60, bitrateMode: "custom", bitrateKbps: 99_000 });
  assert.equal(custom.bitrateKbps, 50_000);
  assert.equal(estimateVideoExportBytes(10, custom), 62_740_000);
});

test("proxy é solicitado somente por resolução, FPS, bitrate ou codec incompatível", () => {
  assert.equal(shouldCreateVideoProxy({ width: 1280, height: 720, fps: 30, bitrate: 8_000_000, codec: "h264", sourcePath: "a.mp4" }), false);
  assert.equal(shouldCreateVideoProxy({ width: 1920, height: 1080, fps: 30, codec: "h264", sourcePath: "a.mp4" }), true);
  assert.equal(shouldCreateVideoProxy({ width: 1280, height: 720, fps: 60, codec: "h264", sourcePath: "a.mp4" }), true);
  assert.equal(shouldCreateVideoProxy({ width: 1280, height: 720, fps: 30, bitrate: 11_000_000, codec: "h264", sourcePath: "a.mp4" }), true);
  assert.equal(shouldCreateVideoProxy({ width: 1280, height: 720, fps: 30, codec: "hevc", sourcePath: "a.mp4" }), true);
});

test("fingerprint rápido combina caminho canônico, metadados e amostras do início e fim", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kaoz-render-fingerprint-"));
  try {
    const filePath = path.join(directory, "aula.mp4");
    await writeFile(filePath, Buffer.concat([Buffer.alloc(1_100_000, 1), Buffer.alloc(1_100_000, 2)]));
    const first = await createVideoSourceFingerprint(filePath);
    const second = await createVideoSourceFingerprint(filePath);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(first.canonicalPath, second.canonicalPath);
    await writeFile(filePath, Buffer.concat([Buffer.alloc(1_100_000, 1), Buffer.alloc(1_100_000, 3)]));
    const changed = await createVideoSourceFingerprint(filePath);
    assert.notEqual(first.quickHash, changed.quickHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("curvas puras mantêm preview e expressões do renderer na mesma janela temporal", () => {
  const event = { start: 10, duration: 2 };
  assert.deepEqual(motionRampTiming(event), { start: 10, rampEnd: 10.56, holdEnd: 11.52, end: 12, entry: 0.56, exit: 0.48 });
  assert.equal(transitionEnvelope(event, 9), 0);
  assert.equal(transitionEnvelope(event, 10), 1);
  assert.equal(transitionEnvelope(event, 11), 0);
});

test("cache LRU remove arquivos antigos, protege projeto ativo e limpa partials", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kaoz-render-cache-"));
  try {
    const oldDirectory = path.join(directory, "old-plan", "chunks-v1");
    const activeDirectory = path.join(directory, "active-plan", "chunks-v1");
    await mkdir(oldDirectory, { recursive: true });
    await mkdir(activeDirectory, { recursive: true });
    const oldPath = path.join(oldDirectory, "old.mp4");
    const activePath = path.join(activeDirectory, "active.mp4");
    const partialPath = path.join(oldDirectory, "broken.partial.mp4");
    await writeFile(oldPath, Buffer.alloc(1024));
    await writeFile(activePath, Buffer.alloc(1024));
    await writeFile(partialPath, Buffer.alloc(64));
    await cleanupVideoRenderPartials(directory);
    assert.equal(await readFile(partialPath).then(() => true).catch(() => false), false);
    const result = await pruneVideoRenderCache(directory, 0.0000005, new Set(["active-plan"]));
    assert.equal(result.removedFiles, 1);
    assert.equal(await readFile(oldPath).then(() => true).catch(() => false), false);
    assert.equal(await readFile(activePath).then(() => true).catch(() => false), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("motor CapCut expõe fila por job, chunks, proxy, trecho exato e exportação separada do DaVinci", async () => {
  const [renderer, jobs, route, batch, panel] = await Promise.all([
    readFile(path.join(process.cwd(), "services", "davinci-free", "intelligent-edit.renderer.ts"), "utf8"),
    readFile(path.join(process.cwd(), "services", "davinci-free", "video-render-job.service.ts"), "utf8"),
    readFile(path.join(process.cwd(), "app", "api", "davinci-free", "route.ts"), "utf8"),
    readFile(path.join(process.cwd(), "services", "davinci-free", "course-batch.service.ts"), "utf8"),
    readFile(path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"), "utf8"),
  ]);
  assert.match(renderer, /bodyChunkRanges/);
  assert.match(renderer, /chunks-v1/);
  assert.match(renderer, /outputPath\.replace\(/);
  assert.doesNotMatch(renderer, /const partialPath = `\$\{outputPath\}\.partial`/);
  assert.match(renderer, /"-t",\s*plan\.media\.durationSeconds\.toFixed\(3\)/);
  assert.match(renderer, /\$\{prefix\}-\$\{crypto\.randomUUID\(\)\}/);
  assert.match(renderer, /finalizeVideoFromSegments/);
  assert.doesNotMatch(renderer, /joined\.mp4/);
  assert.match(jobs, /queued[\s\S]*running[\s\S]*completed[\s\S]*failed[\s\S]*cancelled/);
  assert.match(jobs, /Proxy pausado para uma exportação prioritária/);
  assert.match(route, /"start-proxy"/);
  assert.match(route, /"start-spot-preview"/);
  assert.match(route, /"start-export"/);
  assert.match(route, /renderJobs: renderJobs\.jobs/);
  assert.match(batch, /version: 3/);
  assert.match(batch, /kind: "batch-export"/);
  assert.match(panel, /Renderizar trecho exato/);
  assert.match(panel, /Exportar vídeo/);
  assert.match(panel, /Enviar ao DaVinci/);
  assert.match(panel, /setFinalPreviewJobId\(job\.id\)/);
  assert.match(panel, /Render final · efeitos aplicados/);
  assert.match(panel, /Ver render final/);
  assert.match(panel, /jobId=\$\{activeRenderedJobId\}/);
  assert.match(panel, /pendingBrowserDownloadJobRef/);
  assert.match(panel, /Baixa na pasta configurada no Chrome/);
  assert.match(panel, /!renderedPreviewJob && activeLowerThird/);
});

test("player abre o render final concluído e mantém o trecho exato como alternativa", () => {
  const jobs = [
    { id: "export-new", planId: "plan-a", kind: "export" as const, status: "completed" as const, resultPath: "new.mp4" },
    { id: "export-old", planId: "plan-a", kind: "export" as const, status: "completed" as const, resultPath: "old.mp4" },
    { id: "spot", planId: "plan-a", kind: "spot-preview" as const, status: "completed" as const, resultPath: "spot.mp4" },
  ];
  assert.equal(latestCompletedExportJob(jobs, "plan-a")?.id, "export-new");
  assert.equal(renderedPreviewSelection(jobs, "export-new", "spot").activeJob?.id, "export-new");
  assert.equal(renderedPreviewSelection(jobs, null, "spot").activeJob?.id, "spot");
  assert.equal(renderedPreviewSelection(jobs, "missing", null).activeJob, undefined);
});

