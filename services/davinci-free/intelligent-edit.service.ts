import crypto from "node:crypto";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { getSpeechService, speechRuntimeEnvironment } from "@/services/speech/speech.service";
import type { SpeechRuntimeEnvironment, SpeechTranscriptionOptions, SpeechTranscriptionResult } from "@/services/speech/speech.types";
import {
  getConfiguredAgentIdentity,
  queryConfiguredCodexCli,
  queryConfiguredAgentCli,
} from "@/services/agent-llm/agent-llm.service";
import {
  INTELLIGENT_EDIT_PLAN_VERSION,
  type IntelligentCaption,
  type IntelligentCourseIdentity,
  type IntelligentEditAnalysisInput,
  type IntelligentEditEvent,
  type IntelligentEditPlan,
  type IntelligentPedagogicalAnalysis,
  type IntelligentEditStyle,
  type IntelligentMotionPace,
  type IntelligentEditTextVariant,
  type IntelligentSoundEffect,
  type TimedTranscriptSegment,
} from "./intelligent-edit.types";
import {
  composeMotionEvents,
  normalizeMotionPace,
  resolveMotionProfile,
} from "./intelligent-edit.motion";
import { courseThemeDesign } from "./intelligent-edit.design";
import { resolveCourseTheme } from "./course-theme.service";
import {
  cleanLessonTitle,
  lessonSubtitle,
  narrativeHighlights,
} from "./course-identity.service";
import {
  DEFAULT_SUBJECT_ANCHOR,
  isReliableVisualAnchor,
  stabilizeSubjectAnchor,
  type VisualAnchor,
} from "./visual-anchor";
import { resolveLocalVideoSource } from "./video-source";
import {
  analyzePedagogicalTranscript,
  pedagogicalAnalysisDigest,
} from "./pedagogical-analysis";

const ROOT = path.join(getLocalDataDir(), "davinci-resolve-free", "intelligent");
const LATEST_PATH = path.join(ROOT, "latest-analysis.json");
const ANALYSIS_STATUS_PATH = path.join(ROOT, "analysis-status.json");
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".aac", ".m4a", ".flac"]);

export type IntelligentAnalysisStatus = {
  status: "running" | "completed" | "failed";
  requestId: string;
  sourcePath: string;
  startedAt: string;
  progress?: number;
  stage?: string;
  completedAt?: string;
  planId?: string;
  error?: string;
};

async function writeAnalysisStatus(status: IntelligentAnalysisStatus) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(ANALYSIS_STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function readIntelligentAnalysisStatus(): Promise<IntelligentAnalysisStatus | null> {
  return readFile(ANALYSIS_STATUS_PATH, "utf8")
    .then((raw) => JSON.parse(raw) as IntelligentAnalysisStatus)
    .catch(() => null);
}

type MediaInfo = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

type SemanticDecision = {
  moduleTitle?: string;
  courseTheme?: {
    key?: string;
    rationale?: string;
    tone?: string;
  };
  introTitle?: string;
  introSubtitle?: string;
  outroTitle?: string;
  outroSubtitle?: string;
  lowerThirds?: Array<{ time: number; title: string; reason?: string }>;
  emphasis?: Array<{ time: number; label?: string; reason?: string }>;
  transitions?: Array<{ time: number; label?: string; reason?: string }>;
  soundEffects?: Array<{
    time: number;
    type: IntelligentSoundEffect;
    reason?: string;
    intensity?: "low" | "medium" | "high";
  }>;
  onScreenText?: Array<{
    time: number;
    text: string;
    variant?: IntelligentEditTextVariant;
    reason?: string;
  }>;
  reviewedCaptions?: Array<{ start: number; end: number; text: string }>;
};

function ffmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH?.trim(),
    ffmpegStaticPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) || "ffmpeg";
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeLabel(value: string, maximum = 100) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function googleDriveSourceOrigin(value: unknown): IntelligentEditAnalysisInput["sourceOrigin"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const origin = value as Record<string, unknown>;
  const fileId = cleanText(origin.fileId);
  const name = safeLabel(cleanText(origin.name), 180);
  const mimeType = cleanText(origin.mimeType).slice(0, 100);
  if (origin.provider !== "google-drive" || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId) || !name || !mimeType) return undefined;
  const sizeBytes = Number(origin.sizeBytes);
  return {
    provider: "google-drive",
    fileId,
    name,
    mimeType,
    ...(Number.isSafeInteger(sizeBytes) && sizeBytes >= 0 ? { sizeBytes } : {}),
    ...(typeof origin.parentId === "string" ? { parentId: origin.parentId.slice(0, 200) } : {}),
    ...(typeof origin.webViewLink === "string" && origin.webViewLink.startsWith("https://drive.google.com/")
      ? { webViewLink: origin.webViewLink.slice(0, 500) }
      : {}),
  };
}

function webSpeechTranscriptSegments(value: unknown): TimedTranscriptSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments = value.slice(0, 2_000).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    const start = Number(candidate.start);
    const end = Number(candidate.end);
    const text = cleanText(candidate.text).replace(/\s+/g, " ").slice(0, 2_000);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 43_200 || !text) return [];
    return [{ start, end, text, source: "webspeech" as const }];
  });
  return segments.length ? segments : undefined;
}

function fitTranscriptToMedia(segments: TimedTranscriptSegment[], durationSeconds: number) {
  return segments.flatMap((segment) => {
    const start = Math.min(durationSeconds, Math.max(0, segment.start));
    const end = Math.min(durationSeconds, Math.max(start, segment.end));
    return end > start ? [{ ...segment, start, end }] : [];
  });
}

function requestId(value: unknown) {
  const normalized = cleanText(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(normalized)) {
    throw new Error("requestId inválido.");
  }
  return normalized;
}

async function localFile(
  value: unknown,
  label: string,
  extensions: ReadonlySet<string>,
  required = false,
) {
  const raw = cleanText(value);
  if (!raw) {
    if (required) throw new Error(`${label} é obrigatório.`);
    return undefined;
  }
  if (!path.win32.isAbsolute(raw) || raw.startsWith("\\\\")) {
    throw new Error(`${label} deve usar um caminho local absoluto.`);
  }
  const resolved = path.win32.normalize(raw);
  if (!extensions.has(path.extname(resolved).toLowerCase())) {
    throw new Error(`${label} possui formato não permitido.`);
  }
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) throw new Error(`${label} não foi encontrado.`);
  return resolved;
}

function runProcess(
  command: string,
  args: string[],
  options: { acceptNonZero?: boolean; timeoutMs?: number } = {},
) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Processo excedeu ${options.timeoutMs ?? 120_000} ms.`));
    }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
      };
      if (code === 0 || options.acceptNonZero) resolve(result);
      else reject(new Error(`FFmpeg falhou (${code}): ${result.stderr.slice(-800)}`));
    });
  });
}

async function inspectMedia(sourcePath: string): Promise<MediaInfo> {
  const result = await runProcess(ffmpegPath(), ["-hide_banner", "-i", sourcePath], {
    acceptNonZero: true,
    timeoutMs: 30_000,
  });
  const output = result.stderr;
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoMatch = output.match(/Video:[^\r\n]*?(\d{2,5})x(\d{2,5})[^\r\n]*?(\d+(?:\.\d+)?)\s*fps/i);
  const tbrMatch = output.match(/Video:[^\r\n]*?(\d{2,5})x(\d{2,5})[^\r\n]*?(\d+(?:\.\d+)?)\s*tbr/i);
  if (!durationMatch || (!videoMatch && !tbrMatch)) {
    throw new Error("Não foi possível identificar duração, resolução e FPS do vídeo.");
  }
  const match = videoMatch || tbrMatch!;
  return {
    durationSeconds:
      Number(durationMatch[1]) * 3600 +
      Number(durationMatch[2]) * 60 +
      Number(durationMatch[3]),
    width: Number(match[1]),
    height: Number(match[2]),
    fps: Math.min(60, Math.max(23.976, Number(match[3]))),
    hasAudio: /Audio:/i.test(output),
  };
}

async function sha256(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function detectSilenceEnds(sourcePath: string, durationSeconds: number) {
  const timeoutMs = Math.min(
    120 * 60_000,
    Math.max(300_000, Math.ceil(durationSeconds * 1_000)),
  );
  const result = await runProcess(
    ffmpegPath(),
    [
      "-hide_banner",
      "-vn",
      "-i",
      sourcePath,
      "-af",
      "silencedetect=noise=-36dB:d=0.35",
      "-f",
      "null",
      "NUL",
    ],
    { acceptNonZero: true, timeoutMs },
  );
  return [...result.stderr.matchAll(/silence_end:\s*([\d.]+)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
}

export function buildAudioChunks(duration: number, silenceEnds: number[]) {
  const chunks: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (duration - start > 0.35) {
    const minimum = start + 8;
    const target = start + 18;
    const maximum = Math.min(duration, start + 30);
    const candidates = silenceEnds.filter((time) => time >= minimum && time <= maximum);
    const selected =
      candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ??
      maximum;
    const end = Math.min(duration, Math.max(start + 0.5, selected));
    chunks.push({ start, end });
    start = end;
  }
  return chunks;
}

async function transcribeChunks(
  sourcePath: string,
  directory: string,
  chunks: Array<{ start: number; end: number }>,
  runtime: SpeechRuntimeEnvironment,
  options: SpeechTranscriptionOptions,
  onProgress?: (completed: number, total: number) => void,
) {
  const speech = getSpeechService();
  const rawResults: Array<{ index: number; start: number; end: number; text: string }> = [];
  let metadata: SpeechTranscriptionResult | undefined;
  const CONCURRENCY = 1;

  for (let index = 0; index < chunks.length; index += CONCURRENCY) {
    const batch = chunks.slice(index, index + CONCURRENCY);
    await Promise.all(
      batch.map(async (chunk, batchOffset) => {
        const chunkIndex = index + batchOffset;
        const output = path.join(directory, `speech-${String(chunkIndex + 1).padStart(4, "0")}.wav`);
        try {
          await runProcess(
            ffmpegPath(),
            [
              "-y",
              "-ss",
              chunk.start.toFixed(3),
              "-t",
              (chunk.end - chunk.start).toFixed(3),
              "-i",
              sourcePath,
              "-vn",
              "-ar",
              "16000",
              "-ac",
              "1",
              output,
            ],
            { timeoutMs: 120_000 },
          );
          const bytes = await readFile(output);
          const result = await speech.transcribe(
            new File([bytes], path.basename(output), { type: "audio/wav" }),
            runtime,
            options,
          );
          metadata ||= result;
          const text = result.text.trim();
          if (text) {
            rawResults.push({
              index: chunkIndex,
              start: chunk.start,
              end: chunk.end,
              text,
            });
          }
        } catch (error) {
          console.warn(`[transcribeChunks] Aviso no trecho ${chunkIndex + 1}/${chunks.length}:`, error);
        }
      }),
    );
    onProgress?.(Math.min(index + batch.length, chunks.length), chunks.length);
  }

  rawResults.sort((a, b) => a.index - b.index);
  const segments: TimedTranscriptSegment[] = rawResults.map((item) => ({
    start: item.start,
    end: item.end,
    text: item.text,
    source: "local-asr",
  }));

  if (segments.length === 0) {
    throw new Error("A transcrição não retornou texto utilizável.");
  }
  return {
    segments,
    transcription: {
      engine: metadata?.engine || "cloud",
      modelId: metadata?.modelId,
      backend: metadata?.backend,
      deviceName: metadata?.deviceName,
      language: "pt" as const,
    },
  };
}

function wordsToCaptions(segments: TimedTranscriptSegment[]): IntelligentCaption[] {
  return segments.flatMap((segment) => {
    const words = segment.text.split(/\s+/).filter(Boolean);
    const groupSize = 8;
    const groups: string[][] = [];
    for (let index = 0; index < words.length; index += groupSize) {
      groups.push(words.slice(index, index + groupSize));
    }
    const duration = Math.max(0.8, segment.end - segment.start);
    return groups.map((group, index) => ({
      start: segment.start + (duration * index) / groups.length,
      end: segment.start + (duration * (index + 1)) / groups.length,
      text: group.join(" "),
    }));
  });
}

function isReusableTranscript(candidate: IntelligentEditPlan | null, sourceHash: string, options: SpeechTranscriptionOptions): candidate is IntelligentEditPlan {
  if (!candidate || candidate.sourceHash !== sourceHash || candidate.transcript.length === 0) return false;
  if (options.mode === "cloud") return candidate.transcription?.backend === "cloud";
  return (candidate.transcription?.modelId || null) === (options.modelId || null);
}

async function findReusableTranscript(sourceHash: string, options: SpeechTranscriptionOptions) {
  const entries = await readdir(ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const candidate = await readFile(
      path.join(ROOT, entry.name, "intelligent-edit-plan.json"),
      "utf8",
    )
      .then((raw) => JSON.parse(raw) as IntelligentEditPlan)
      .catch(() => null);
    if (isReusableTranscript(candidate, sourceHash, options)) {
      return { segments: candidate.transcript, transcription: candidate.transcription };
    }
  }
  return null;
}

async function transcriptForAnalysis(
  sourcePath: string,
  directory: string,
  durationSeconds: number,
  sourceHash: string,
  runtime: SpeechRuntimeEnvironment,
  options: SpeechTranscriptionOptions,
  onProgress?: (completed: number, total: number) => void,
) {
  const reusable = await findReusableTranscript(sourceHash, options);
  if (reusable) return reusable;
  const silenceEnds = await detectSilenceEnds(sourcePath, durationSeconds);
  const chunks = buildAudioChunks(durationSeconds, silenceEnds);
  return transcribeChunks(sourcePath, directory, chunks, runtime, options, onProgress);
}

function extractJsonObject(output: string): SemanticDecision | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  if (!candidate.trim()) return null;
  try {
    return JSON.parse(candidate) as SemanticDecision;
  } catch {
    return null;
  }
}

function extractJsonArray(output: string): SemanticDecision["reviewedCaptions"] | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const first = output.indexOf("[");
  const last = output.lastIndexOf("]");
  const candidate = fenced || (first >= 0 && last > first ? output.slice(first, last + 1) : "");
  if (!candidate.trim()) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed)
      ? parsed as NonNullable<SemanticDecision["reviewedCaptions"]>
      : null;
  } catch {
    return null;
  }
}

function clampTime(value: unknown, duration: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(duration, numeric)) : 0;
}

async function semanticPlan(
  segments: TimedTranscriptSegment[],
  captions: IntelligentCaption[],
  input: IntelligentEditAnalysisInput,
  duration: number,
  pedagogy: IntelligentPedagogicalAnalysis,
) {
  const transcript = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join("\n")
    .slice(0, 24_000);
  const prompt = [
    "Você é um editor profissional de vídeos educacionais.",
    "Analise apenas a transcrição temporal abaixo e retorne SOMENTE JSON válido.",
    "Crie ritmo moderno e impactante, mas profissional. Use efeitos somente quando semanticamente justificados.",
    "Formato obrigatório:",
    '{"moduleTitle":"...","courseTheme":{"key":"ancestral|performance|wellness|business|technology|creative","rationale":"...","tone":"..."},"introTitle":"...","introSubtitle":"...","outroTitle":"...","outroSubtitle":"...","lowerThirds":[{"time":0,"title":"...","reason":"..."}],"emphasis":[{"time":12.5,"label":"...","reason":"..."}],"transitions":[{"time":30,"label":"...","reason":"..."}],"soundEffects":[{"time":12.5,"type":"soft-whoosh|interface-click|page-flip|keyboard-typing|light-impact|subtle-pop|positive-confirmation|soft-error|rising-swoosh","intensity":"low|medium|high","reason":"..."}],"onScreenText":[{"time":12.5,"text":"2 a 6 palavras","variant":"concept|stat|action|quote","reason":"..."}],"reviewedCaptions":[{"start":0,"end":2,"text":"..."}]}',
    "Escolha courseTheme pelo assunto central, público, promessa e linguagem recorrente do curso — não pelo gosto visual desta aula isolada.",
    "A abertura e o encerramento devem refletir a promessa e a próxima ação específicas desta aula; evite frases genéricas.",
    "Escolha de 4 a 7 textos de impacto com 2 a 6 palavras, diferentes da legenda corrida.",
    "Classifique cada texto como concept, stat, action ou quote conforme sua função narrativa.",
    "Escolha efeitos sonoros somente quando reforçarem uma ação, mudança de capítulo, revelação, confirmação, erro, digitação ou conceito importante.",
    "Use poucos efeitos, deixe pelo menos 8 segundos entre eles e nunca use som ambiente. Evite cobrir frases densas; prefira pausas ou o início exato do evento.",
    "Use interface-click para ações na tela, page-flip para capítulos, keyboard-typing para digitação, light-impact para pontos fortes, subtle-pop para elementos breves, positive-confirmation para conclusões corretas, soft-error para erros, rising-swoosh para revelações e soft-whoosh para transições suaves.",
    "Não altere timestamps das legendas. Corrija somente ortografia e pontuação.",
    "Use a análise pedagógica consolidada como referência principal para promessa, capítulos e próxima ação.",
    `Curso: ${input.courseName || "não informado"}`,
    `Módulo: ${input.moduleName}`,
    `Aula ${input.lessonNumber || "sem número"}: ${input.lessonName || input.moduleName}`,
    `Estilo: ${input.style || "subtle"}`,
    `Duração: ${duration.toFixed(1)} segundos`,
    "Análise pedagógica consolidada:",
    pedagogicalAnalysisDigest(pedagogy) || "Nenhum item pedagógico confiável identificado.",
    "Transcrição temporal inicial para contexto de linguagem:",
    transcript,
  ].join("\n");
  const fallbackDecision = deterministicSemanticDecision(segments, input, duration, pedagogy);
  if (input.useAgent === false) {
    return {
      decision: fallbackDecision,
      source: "deterministic-fallback" as const,
      inputCharacters: prompt.length,
    };
  }
  try {
    const response = await queryConfiguredAgentCli(prompt, { useExternalTools: false });
    const decision = response ? extractJsonObject(response) : null;
    if (!decision) {
      return {
        decision: fallbackDecision,
        source: "deterministic-fallback" as const,
        inputCharacters: prompt.length,
      };
    }
    if (decision.reviewedCaptions?.length !== captions.length) {
      const captionPrompt = [
        "Revise as legendas em português brasileiro.",
        `Retorne SOMENTE um array JSON com exatamente ${captions.length} objetos.`,
        "Preserve start e end exatamente. Corrija apenas ortografia, pontuação e erros óbvios de reconhecimento.",
        "Não invente palavras quando o sentido estiver incerto.",
        JSON.stringify(captions),
      ].join("\n");
      const captionResponse = await queryConfiguredAgentCli(captionPrompt, {
        useExternalTools: false,
      });
      const reviewed = captionResponse ? extractJsonArray(captionResponse) : null;
      if (reviewed?.length === captions.length) {
        decision.reviewedCaptions = reviewed;
      }
    }
    const identity = await getConfiguredAgentIdentity();
    return {
      decision,
      source: "agent" as const,
      provider: identity.provider,
      model: identity.model,
      inputCharacters: prompt.length,
    };
  } catch {
    return {
      decision: fallbackDecision,
      source: "deterministic-fallback" as const,
      inputCharacters: prompt.length,
    };
  }
}

function deterministicSemanticDecision(
  segments: TimedTranscriptSegment[],
  input: IntelligentEditAnalysisInput,
  duration: number,
  pedagogy: IntelligentPedagogicalAnalysis,
): SemanticDecision {
  const title = cleanLessonTitle(input.lessonName || input.moduleName);
  const transcript = segments.map((segment) => segment.text).join(" ");
  const highlights = narrativeHighlights(segments, duration);
  const pedagogicalItems = pedagogy.items.filter((item) => item.status !== "rejected");
  const promise = firstPedagogicalItem(pedagogicalItems, ["promise", "objective"]);
  const nextAction = firstPedagogicalItem(pedagogicalItems, ["exercise", "action", "summary"]);
  const nextLesson = firstPedagogicalItem(pedagogicalItems, ["next-link"]);
  return {
    moduleTitle: title,
    introTitle: title,
    introSubtitle: pedagogicalTitle(promise, lessonSubtitle(title, transcript)),
    outroTitle: pedagogicalTitle(nextAction, "Aplique antes de avançar"),
    outroSubtitle: pedagogicalTitle(nextLesson, "Leve esta etapa para a próxima aula"),
    lowerThirds: pedagogicalLowerThirds(pedagogicalItems),
    emphasis: pedagogicalEmphasis(pedagogicalItems, highlights),
    onScreenText: pedagogicalOnScreenText(pedagogicalItems, highlights),
    soundEffects: pedagogicalSoundEffects(pedagogicalItems),
  };
}

type PedagogicalItem = IntelligentPedagogicalAnalysis["items"][number];
type NarrativeHighlight = ReturnType<typeof narrativeHighlights>[number];

function pedagogicalSoundEffects(items: PedagogicalItem[]): NonNullable<SemanticDecision["soundEffects"]> {
  const typeForKind: Partial<Record<PedagogicalItem["kind"], IntelligentSoundEffect>> = {
    chapter: "page-flip",
    demonstration: "interface-click",
    "process-step": "subtle-pop",
    warning: "light-impact",
    "common-error": "soft-error",
    exercise: "keyboard-typing",
    action: "positive-confirmation",
    summary: "rising-swoosh",
    "next-link": "soft-whoosh",
  };
  return items
    .filter((item) => item.status !== "rejected" && Boolean(typeForKind[item.kind]))
    .map((item) => ({
      time: item.start,
      type: typeForKind[item.kind]!,
      intensity: item.importance === "high" ? "medium" as const : "low" as const,
      reason: item.editorialSuggestion,
    }));
}

const SOUND_EFFECTS = new Set<IntelligentSoundEffect>([
  "soft-whoosh",
  "interface-click",
  "page-flip",
  "keyboard-typing",
  "light-impact",
  "subtle-pop",
  "positive-confirmation",
  "soft-error",
  "rising-swoosh",
]);

const SOUND_EFFECT_LABELS: Record<IntelligentSoundEffect, string> = {
  "soft-whoosh": "Whoosh suave",
  "interface-click": "Clique de interface",
  "page-flip": "Virada de página",
  "keyboard-typing": "Digitação",
  "light-impact": "Impacto leve",
  "subtle-pop": "Pop discreto",
  "positive-confirmation": "Confirmação positiva",
  "soft-error": "Erro suave",
  "rising-swoosh": "Swoosh ascendente",
};

const SOUND_EFFECT_DURATIONS: Record<IntelligentSoundEffect, number> = {
  "soft-whoosh": 2.12,
  "interface-click": 1.06,
  "page-flip": 1.22,
  "keyboard-typing": 2.8,
  "light-impact": 3.79,
  "subtle-pop": 0.72,
  "positive-confirmation": 2.04,
  "soft-error": 1.88,
  "rising-swoosh": 3.19,
};

function soundEffectGainDb(intensity: unknown) {
  if (intensity === "high") return 1.5;
  if (intensity === "low") return -3;
  return 0;
}

function selectedSoundEffects(input: {
  duration: number;
  pack: "minimal" | "dynamic" | "tech";
  semantic: SemanticDecision | null;
}) {
  const limits = {
    minimal: { minimumGap: 24, maximum: 6 },
    dynamic: { minimumGap: 14, maximum: 10 },
    tech: { minimumGap: 10, maximum: 14 },
  }[input.pack];
  const candidates = input.semantic?.soundEffects || [];
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (!SOUND_EFFECTS.has(candidate.type)) continue;
    const time = clampTime(candidate.time, input.duration);
    if (selected.some((item) => Math.abs(clampTime(item.time, input.duration) - time) < limits.minimumGap)) continue;
    selected.push({ ...candidate, time });
    if (selected.length >= limits.maximum) break;
  }
  return selected;
}

function firstPedagogicalItem(
  items: PedagogicalItem[],
  kinds: PedagogicalItem["kind"][],
) {
  return items.find((item) => kinds.includes(item.kind));
}

function pedagogicalTitle(item: PedagogicalItem | undefined, fallback: string) {
  return item?.title || fallback;
}

function pedagogicalLowerThirds(items: PedagogicalItem[]) {
  return items
    .filter((item) => item.kind === "chapter")
    .slice(0, 6)
    .map((item) => ({ time: item.start, title: item.title, reason: item.editorialSuggestion }));
}

function semanticHighlightItems(items: PedagogicalItem[]) {
  return items
    .filter((item) => ["concept", "definition", "process-step", "warning", "common-error"].includes(item.kind))
    .slice(0, 7);
}

function pedagogicalEmphasis(items: PedagogicalItem[], fallback: NarrativeHighlight[]) {
  const selected = semanticHighlightItems(items);
  if (!selected.length) {
    return fallback.map((highlight) => ({
      time: highlight.time,
      label: highlight.text,
      reason: "Momento relevante identificado na transcrição.",
    }));
  }
  return selected.map((item) => ({
    time: item.start,
    label: item.title,
    reason: item.editorialSuggestion,
  }));
}

function pedagogicalTextVariant(item: PedagogicalItem) {
  return item.kind === "warning" || item.kind === "common-error"
    ? "action" as const
    : "concept" as const;
}

function pedagogicalOnScreenText(items: PedagogicalItem[], fallback: NarrativeHighlight[]) {
  const selected = semanticHighlightItems(items);
  if (!selected.length) {
    return fallback.map((highlight) => ({
      time: highlight.time,
      text: highlight.text,
      variant: highlight.variant,
      reason: "Síntese semântica extraída da fala.",
    }));
  }
  return selected.map((item) => ({
    time: item.start,
    text: item.title,
    variant: pedagogicalTextVariant(item),
    reason: item.editorialSuggestion,
  }));
}

export function buildEditEvents(input: {
  moduleName: string;
  duration: number;
  style: IntelligentEditStyle;
  motionPace?: IntelligentMotionPace;
  semantic: SemanticDecision | null;
  sfxEnabled?: boolean;
  sfxPack?: "minimal" | "dynamic" | "tech";
}) {
  const motion = resolveMotionProfile(input.motionPace, input.style);
  const events: IntelligentEditEvent[] = [
    {
      id: "intro",
      kind: "intro",
      start: 0,
      duration: motion.cardDuration,
      label: safeLabel(
        input.semantic?.introTitle || input.semantic?.moduleTitle || input.moduleName,
        72,
      ),
      subtitle: safeLabel(
        input.semantic?.introSubtitle || "O que você vai aprender nesta aula",
        100,
      ),
      reason: "Abertura contextual criada a partir da promessa da aula.",
    },
    {
      id: "lower-third-start",
      kind: "lower-third",
      start: 0.6,
      duration: motion.lowerThirdDuration,
      label: input.semantic?.moduleTitle || input.moduleName,
      reason: "Identificação inicial do módulo.",
    },
  ];
  const lowerThirds = input.semantic?.lowerThirds?.slice(0, 6) || [];
  for (const [index, item] of lowerThirds.entries()) {
    const time = clampTime(item.time, input.duration);
    if (time < 1) continue;
    events.push({
      id: `lower-third-${index + 1}`,
      kind: "lower-third",
      start: time,
      duration: motion.lowerThirdDuration,
      label: safeLabel(item.title || input.moduleName),
      reason: cleanText(item.reason, "Mudança de seção detectada na fala."),
    });
  }
  const fallbackEmphasis = input.duration > 25 ? [input.duration * 0.35, input.duration * 0.7] : [input.duration * 0.55];
  const emphasis = input.semantic?.emphasis?.slice(0, input.style === "dynamic" ? 8 : 4);
  const selectedEmphasis: NonNullable<SemanticDecision["emphasis"]> =
    emphasis?.length ? emphasis : fallbackEmphasis.map((time) => ({ time }));
  for (const [index, item] of selectedEmphasis.entries()) {
    events.push({
      id: `zoom-${index + 1}`,
      kind: "zoom",
      start: clampTime(item.time, input.duration),
      duration: motion.zoomDuration,
      label: safeLabel(item.label || "Ênfase"),
      reason: cleanText(item.reason, "Momento de ênfase identificado pela fala."),
      scale: motion.zoomScale,
    });
  }
  const impactTexts =
    input.semantic?.onScreenText?.slice(0, 7) ||
    selectedEmphasis.slice(0, 6).map((item) => ({
      time: item.time,
      text: item.label || "Ponto importante",
      variant: "concept" as const,
      reason: item.reason,
    }));
  for (const [index, item] of impactTexts.entries()) {
    const requestedTime = clampTime(item.time, input.duration);
    events.push({
      id: `impact-text-${index + 1}`,
      kind: "impact-text",
      start: requestedTime < 2 ? Math.min(5.2, input.duration - 1.8) : requestedTime,
      duration: motion.impactDuration,
      label: safeLabel(item.text || "Ponto importante", 44),
      reason: cleanText(item.reason, "Conceito principal identificado na fala."),
      variant: (["concept", "stat", "action", "quote"].includes(String(item.variant))
        ? item.variant
        : "concept") as IntelligentEditTextVariant,
    });
  }
  const transitions = input.semantic?.transitions?.slice(0, 5) || [];
  for (const [index, item] of transitions.entries()) {
    events.push({
      id: `transition-${index + 1}`,
      kind: "transition",
      start: clampTime(item.time, input.duration),
      duration: motion.transitionDuration,
      label: safeLabel(item.label || "Mudança de seção"),
      reason: cleanText(item.reason, "Mudança de assunto."),
    });
  }
  if (input.sfxEnabled !== false) {
    const soundEffects = selectedSoundEffects({
      duration: input.duration,
      pack: input.sfxPack || "dynamic",
      semantic: input.semantic,
    });
    for (const [index, item] of soundEffects.entries()) {
      events.push({
        id: `sound-effect-${index + 1}`,
        kind: "sound-effect",
        start: item.time,
        duration: SOUND_EFFECT_DURATIONS[item.type],
        label: SOUND_EFFECT_LABELS[item.type],
        reason: cleanText(item.reason, "Ponto sonoro escolhido pela análise semântica."),
        soundEffect: item.type,
        soundEffectGainDb: soundEffectGainDb(item.intensity),
      });
    }
  }
  events.push({
    id: "outro",
    kind: "outro",
    start: input.duration,
    duration: motion.cardDuration,
    label: safeLabel(input.semantic?.outroTitle || "Coloque esta ideia em prática", 72),
    subtitle: safeLabel(
      input.semantic?.outroSubtitle || "Continue para a próxima etapa",
      100,
    ),
    reason: "Encerramento contextual e orientado à próxima ação.",
  });

  if (input.style === "meme") {
    const memeSoundTags = [
      "vine-boom",
      "faah",
      "fart",
      "error",
      "punch",
      "baby-laugh",
      "spiderman",
      "nemesis",
      "anime-wow",
      "rizz",
      "bone-crack",
      "among-us",
    ] as const;
    const memeLabels = [
      "Vine Boom (Impacto)",
      "FAAAH (Reação)",
      "Fart Meme (Ops)",
      "Windows Error (Erro)",
      "Punch Hit (Pancada)",
      "Baby Laugh (Risada)",
      "Spider-Man Meme (Música)",
      "Nemesis Reveal (Suspense)",
      "Anime WOW (Brilho)",
      "Rizz Sound (Carisma)",
      "Bone Crack (Impacto)",
      "Among Us (Impostor)",
    ];

    const triggers = events.filter((e) => e.kind === "zoom" || e.kind === "impact-text");
    for (const [index, event] of triggers.entries()) {
      const memeTag = memeSoundTags[index % memeSoundTags.length];
      const memeLabel = memeLabels[index % memeLabels.length];
      events.push({
        id: `meme-sfx-${index + 1}`,
        kind: "meme-sfx",
        start: event.start,
        duration: 0.8,
        label: `🤡 ${memeLabel}`,
        reason: "Efeito cômico acionado para o Modo Meme.",
        memeTag,
      });
      if (event.kind === "zoom") {
        event.scale = 1.14;
        event.duration = Math.max(1.9, motion.zoomDuration * 0.8);
      }
    }
  }

  return composeMotionEvents(events, input.duration, motion);
}

function extractVisualAnchors(output: string): VisualAnchor[] {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  if (!candidate.trim()) return [];
  try {
    const parsed = JSON.parse(candidate) as { anchors?: unknown };
    if (!Array.isArray(parsed.anchors)) return [];
    return parsed.anchors.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const index = Number(item.index);
      const x = Number(item.x);
      const y = Number(item.y);
      const confidence = Number(item.confidence);
      if (!Number.isInteger(index) || !Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [{
        index,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        confidence: Number.isFinite(confidence) ? confidence : undefined,
      }];
    });
  } catch {
    return [];
  }
}

async function visualEditPlan(input: {
  sourcePath: string;
  directory: string;
  duration: number;
  events: IntelligentEditEvent[];
}) {
  const zoomEvents = input.events.filter((event) => event.kind === "zoom").slice(0, 4);
  const sampleEvents = zoomEvents.length
    ? zoomEvents
    : input.events.filter((event) => event.kind === "lower-third").slice(0, 4);
  if (!sampleEvents.length) {
    return {
      events: input.events,
      visual: {
        source: "safe-center-fallback" as const,
        sampledFrames: 0,
      },
    };
  }

  const paddedEvents = Array.from({ length: 4 }, (_, index) =>
    sampleEvents[index] || sampleEvents[sampleEvents.length - 1]);
  const framePaths: string[] = [];
  for (const [index, event] of paddedEvents.entries()) {
    const framePath = path.join(input.directory, `visual-frame-${index + 1}.jpg`);
    await runProcess(ffmpegPath(), [
      "-y",
      "-ss",
      Math.max(0, Math.min(input.duration - 0.1, event.start + 0.35)).toFixed(3),
      "-i",
      input.sourcePath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      framePath,
    ], { timeoutMs: 45_000 });
    framePaths.push(framePath);
  }

  const contactSheetPath = path.join(input.directory, "visual-contact-sheet.jpg");
  const contactArgs = ["-y"];
  for (const framePath of framePaths) contactArgs.push("-i", framePath);
  contactArgs.push(
    "-filter_complex",
    "[0:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v0];[1:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v1];[2:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v2];[3:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v3];[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|640_0|0_360|640_360[out]",
    "-map",
    "[out]",
    "-frames:v",
    "1",
    contactSheetPath,
  );
  await runProcess(ffmpegPath(), contactArgs, { timeoutMs: 60_000 });

  let anchors: VisualAnchor[] = [];
  try {
    const prompt = [
      "Analise esta folha 2x2 de quadros de um vídeo educacional.",
      "Os painéis seguem a ordem: 1 superior esquerdo, 2 superior direito, 3 inferior esquerdo, 4 inferior direito.",
      "Para cada painel, localize o ponto focal que deve permanecer no centro de um zoom: normalmente o centro do rosto, levemente abaixo dos olhos.",
      "Retorne SOMENTE JSON no formato:",
      '{"anchors":[{"index":1,"x":0.5,"y":0.4,"confidence":0.95}]}',
      "Prioridade: x e y devem ser relativos somente ao painel indicado. Ignore a posicao do painel na folha 2x2.",
      "Localize o apresentador principal e ignore textos, computador, fundo e outros objetos.",
    ].join("\n");
    const response = await queryConfiguredCodexCli(prompt, {
      useExternalTools: false,
      referenceImagePath: contactSheetPath,
    });
    anchors = extractVisualAnchors(response);
  } catch {
    anchors = [];
  }

  const enriched = input.events.map((event) => ({ ...event }));
  let previousSubjectAnchor = DEFAULT_SUBJECT_ANCHOR;
  for (const [index, event] of zoomEvents.entries()) {
    const target = enriched.find((candidate) => candidate.id === event.id);
    if (!target) continue;
    const anchor = anchors.find((candidate) => candidate.index === index + 1);
    previousSubjectAnchor = stabilizeSubjectAnchor(anchor, previousSubjectAnchor);
    target.x = 0.5;
    target.y = 0.5;
    target.scale = 1.12;
  }

  const transitions = enriched
    .filter((event) => event.kind === "transition")
    .sort((a, b) => a.start - b.start);
  const scales = [1.055, 1.095, 1.045, 1.085, 1.06];
  for (const [index, transition] of transitions.entries()) {
    const nextStart = transitions[index + 1]?.start ?? input.duration;
    const nearest = enriched
      .filter((event) => event.kind === "zoom" && event.x !== undefined)
      .sort((a, b) => Math.abs(a.start - transition.start) - Math.abs(b.start - transition.start))[0];
    enriched.push({
      id: `cut-${index + 1}`,
      kind: "cut",
      start: transition.start,
      duration: Math.max(1.5, nextStart - transition.start),
      label: transition.label,
      reason: `Mudança de enquadramento: ${transition.reason}`,
      scale: scales[index % scales.length],
      x: nearest?.x ?? 0.5,
      y: nearest?.y ?? 0.42,
    });
  }

  return {
    events: enriched.sort((a, b) => a.start - b.start),
    visual: {
      source: anchors.filter(isReliableVisualAnchor).length >= sampleEvents.length
        ? "agent-contact-sheet" as const
        : "safe-center-fallback" as const,
      contactSheetPath,
      sampledFrames: sampleEvents.length,
    },
  };
}

function reviewedCaptions(
  original: IntelligentCaption[],
  semantic: SemanticDecision | null,
  duration: number,
) {
  const candidate = semantic?.reviewedCaptions;
  if (!Array.isArray(candidate) || candidate.length !== original.length) return original;
  return original.map((caption, index) => {
    const reviewed = candidate[index];
    const unchangedTiming =
      Math.abs(clampTime(reviewed.start, duration) - caption.start) < 0.05 &&
      Math.abs(clampTime(reviewed.end, duration) - caption.end) < 0.05;
    return {
      ...caption,
      text: unchangedTiming && cleanText(reviewed.text) ? cleanText(reviewed.text).slice(0, 120) : caption.text,
    };
  });
}

function formatSrtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function toSrt(captions: IntelligentCaption[]) {
  return captions
    .map((caption, index) =>
      `${index + 1}\n${formatSrtTime(caption.start)} --> ${formatSrtTime(caption.end)}\n${caption.text}\n`,
    )
    .join("\n");
}

function toPlainTranscript(segments: TimedTranscriptSegment[]) {
  return segments
    .map((segment) => `[${formatSrtTime(segment.start).slice(0, 8)}] ${segment.text.trim()}`)
    .filter((line) => line.length > 11)
    .join("\n");
}

export async function analyzeIntelligentEdit(
  rawInput: Record<string, unknown>,
): Promise<IntelligentEditPlan> {
  const input: IntelligentEditAnalysisInput = {
    requestId: requestId(rawInput.requestId),
    sourcePath: await resolveLocalVideoSource(rawInput.sourcePath),
    sourceOrigin: googleDriveSourceOrigin(rawInput.sourceOrigin),
    courseName: safeLabel(cleanText(rawInput.courseName), 100) || undefined,
    moduleName: safeLabel(cleanText(rawInput.moduleName, "Módulo"), 100),
    lessonNumber: safeLabel(cleanText(rawInput.lessonNumber, "1"), 12),
    lessonName: safeLabel(cleanText(rawInput.lessonName, "Aula"), 120),
    style: (["subtle", "balanced", "dynamic", "meme"].includes(String(rawInput.style))
      ? rawInput.style
      : "subtle") as IntelligentEditStyle,
    motionPace: normalizeMotionPace(
      rawInput.motionPace,
      (["subtle", "balanced", "dynamic", "meme"].includes(String(rawInput.style))
        ? rawInput.style
        : "subtle") as IntelligentEditStyle,
    ),
    captionsEnabled: rawInput.captionsEnabled !== false,
    reuseCourseTheme: rawInput.reuseCourseTheme !== false,
    musicPath: await localFile(rawInput.musicPath, "Música", AUDIO_EXTENSIONS),
    musicDb: Math.min(-35, Math.max(-40, Number(rawInput.musicDb) || -38)),
    sfxEnabled: rawInput.sfxEnabled !== false,
    sfxVolumeDb: Math.min(-6, Math.max(-30, Number(rawInput.sfxVolumeDb) || -12)),
    sfxPack: (["minimal", "dynamic", "tech"].includes(String(rawInput.sfxPack))
      ? rawInput.sfxPack
      : "dynamic") as "minimal" | "dynamic" | "tech",
    useAgent: rawInput.useAgent !== false,
    transcriptionRuntime: speechRuntimeEnvironment(rawInput.transcriptionRuntime),
    transcriptionModelId: typeof rawInput.transcriptionModelId === "string" ? rawInput.transcriptionModelId : undefined,
    transcriptionDevice: (["auto", "vulkan", "cpu"].includes(String(rawInput.transcriptionDevice))
      ? rawInput.transcriptionDevice
      : "auto") as "auto" | "vulkan" | "cpu",
    transcriptionAllowCloudFallback: rawInput.transcriptionAllowCloudFallback === true,
    transcriptionMode: (["webspeech", "cloud", "local"].includes(String(rawInput.transcriptionMode))
      ? rawInput.transcriptionMode
      : "local") as "webspeech" | "cloud" | "local",
    transcriptionSegments: webSpeechTranscriptSegments(rawInput.transcriptionSegments),
  };
  const transcriptionRuntime = input.transcriptionRuntime || speechRuntimeEnvironment(rawInput.transcriptionRuntime);
  const startedAt = new Date().toISOString();
  const runningStatus = {
    status: "running",
    requestId: input.requestId,
    sourcePath: input.sourcePath,
    startedAt,
  } as const;
  let analysisStatusWrite = Promise.resolve();
  const reportAnalysisProgress = (progress: number, stage: string) => {
    analysisStatusWrite = analysisStatusWrite.then(() => writeAnalysisStatus({
      ...runningStatus,
      progress: Math.max(1, Math.min(99, Math.round(progress))),
      stage,
    }));
    return analysisStatusWrite;
  };
  await reportAnalysisProgress(1, "Preparando vídeo para análise...");
  try {
  const sourceHash = await sha256(input.sourcePath);
  await reportAnalysisProgress(7, "Identificando o arquivo e verificando análises anteriores...");
  const cacheKey = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      sourceHash,
      analysisVersion: 11,
      courseName: input.courseName,
      moduleName: input.moduleName,
      lessonNumber: input.lessonNumber,
      lessonName: input.lessonName,
      style: input.style,
      motionPace: input.motionPace,
      captionsEnabled: input.captionsEnabled,
      reuseCourseTheme: input.reuseCourseTheme,
      musicPath: input.musicPath,
      musicDb: input.musicDb,
      sfxEnabled: input.sfxEnabled,
      sfxVolumeDb: input.sfxVolumeDb,
      sfxPack: input.sfxPack,
      transcriptionModelId: input.transcriptionModelId,
      transcriptionDevice: input.transcriptionDevice,
      transcriptionAllowCloudFallback: input.transcriptionAllowCloudFallback,
      transcriptionMode: input.transcriptionMode,
      transcriptionSegmentsHash: input.transcriptionSegments
        ? crypto.createHash("sha256").update(JSON.stringify(input.transcriptionSegments)).digest("hex")
        : undefined,
    }))
    .digest("hex");
  const directory = path.join(ROOT, cacheKey.slice(0, 16));
  const planPath = path.join(directory, "intelligent-edit-plan.json");
  const cached = await readFile(planPath, "utf8")
    .then((raw) => JSON.parse(raw) as IntelligentEditPlan)
    .catch(() => null);
  if (cached) {
    await analysisStatusWrite;
    await writeFile(LATEST_PATH, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
    await writeAnalysisStatus({
      status: "completed",
      requestId: input.requestId,
      sourcePath: input.sourcePath,
      startedAt,
      progress: 100,
      stage: "Análise e planejamento concluídos.",
      completedAt: new Date().toISOString(),
      planId: cached.id,
    });
    return cached;
  }
  await mkdir(directory, { recursive: true });
  await reportAnalysisProgress(12, "Inspecionando vídeo e áudio...");
  const media = await inspectMedia(input.sourcePath);
  if (!media.hasAudio) throw new Error("O vídeo não possui áudio para orientar a edição.");
  await reportAnalysisProgress(20, "Detectando falas e transcrevendo o áudio...");
  const webSpeechSegments = input.transcriptionSegments
    ? fitTranscriptToMedia(input.transcriptionSegments, media.durationSeconds)
    : undefined;
  if (input.transcriptionMode === "webspeech" && !webSpeechSegments?.length) {
    throw new Error("A transcrição Web Speech não foi recebida do navegador.");
  }
  const transcriptionResult = input.transcriptionMode === "webspeech"
    ? {
        segments: webSpeechSegments!,
        transcription: { engine: "webspeech" as const, backend: "web" as const, language: "pt" as const },
      }
    : await transcriptForAnalysis(
        input.sourcePath,
        directory,
        media.durationSeconds,
        sourceHash,
        transcriptionRuntime,
        {
          modelId: input.transcriptionModelId,
          device: input.transcriptionDevice,
          allowCloudFallback: input.transcriptionAllowCloudFallback,
          mode: input.transcriptionMode === "cloud" ? "cloud" : "configured",
        },
        (completed, total) => {
          void reportAnalysisProgress(
            20 + (completed / Math.max(1, total)) * 38,
            `Transcrevendo áudio: ${completed}/${total} trechos...`,
          );
        },
      );
  const transcript = transcriptionResult.segments;
  await analysisStatusWrite;
  await reportAnalysisProgress(60, "Mapeando objetivos, conceitos e estrutura pedagógica...");
  const rawCaptions = wordsToCaptions(transcript);
  const pedagogy = await analyzePedagogicalTranscript({
    segments: transcript,
    courseName: input.courseName,
    moduleName: input.lessonName || input.moduleName,
    useAgent: input.useAgent !== false,
    queryAgent: (prompt) => queryConfiguredAgentCli(prompt, { useExternalTools: false }),
  });
  await reportAnalysisProgress(68, "Consolidando a estrutura pedagógica da aula...");
  const semantic = await semanticPlan(
    transcript,
    rawCaptions,
    input,
    media.durationSeconds,
    pedagogy,
  );
  const captions = reviewedCaptions(rawCaptions, semantic.decision, media.durationSeconds);
  await reportAnalysisProgress(76, "Definindo identidade visual e legendas...");
  const courseTheme = await resolveCourseTheme({
    courseName: input.courseName,
    transcript: transcript.map((segment) => segment.text).join("\n"),
    suggestedKey: semantic.decision?.courseTheme?.key,
    rationale: semantic.decision?.courseTheme?.rationale,
    tone: semantic.decision?.courseTheme?.tone,
    reuse: input.reuseCourseTheme !== false,
  });
  const baseEvents = buildEditEvents({
    moduleName: input.lessonName || input.moduleName,
    duration: media.durationSeconds,
    style: input.style || "subtle",
    motionPace: input.motionPace,
    semantic: semantic.decision,
    sfxEnabled: input.sfxEnabled,
    sfxPack: input.sfxPack,
  });
  await reportAnalysisProgress(84, "Analisando enquadramento e pontos de destaque...");
  const visual = await visualEditPlan({
    sourcePath: input.sourcePath,
    directory,
    duration: media.durationSeconds,
    events: baseEvents,
  });
  await reportAnalysisProgress(95, "Salvando o plano de edição...");
  const transcriptPath = path.join(directory, "transcript.json");
  const transcriptTextPath = path.join(directory, "transcript.txt");
  const pedagogyPath = path.join(directory, "pedagogical-analysis.json");
  const captionsPath = path.join(directory, "captions-reviewed.srt");
  const plan: IntelligentEditPlan = {
    version: INTELLIGENT_EDIT_PLAN_VERSION,
    id: cacheKey.slice(0, 16),
    requestId: input.requestId,
    sourceHash,
    sourcePath: input.sourcePath,
    sourceOrigin: input.sourceOrigin,
    createdAt: new Date().toISOString(),
    style: input.style || "subtle",
    motion: { pace: normalizeMotionPace(input.motionPace, input.style || "subtle") },
    design: courseThemeDesign(
      courseTheme.profile,
      input.captionsEnabled !== false,
    ),
    courseTheme: { ...courseTheme.profile, reused: courseTheme.reused },
    courseName: input.courseName,
    moduleName: input.moduleName,
    lessonNumber: input.lessonNumber,
    lessonName: input.lessonName,
    media: {
      ...media,
      musicPath: input.musicPath,
      musicDb: input.musicDb ?? -38,
      sfxEnabled: input.sfxEnabled !== false,
      sfxVolumeDb: input.sfxVolumeDb ?? -18,
      sfxPack: input.sfxPack || "dynamic",
    },
    transcript,
    transcription: transcriptionResult.transcription,
    pedagogy,
    captions,
    events: visual.events,
    audio: {
      noiseReduction: true,
      equalization: true,
      compression: true,
      limiter: true,
      targetLufs: -16,
    },
    color: { enabled: true, mode: "conservative-local" },
    cursorAnalysis: {
      status: "coordinates-required",
      message: "O áudio define quando destacar; coordenadas exigem rastreamento visual local antes do efeito.",
    },
    semantic: {
      source: semantic.source,
      provider: semantic.provider,
      model: semantic.model,
      inputCharacters: semantic.inputCharacters,
      captionReview:
        semantic.decision?.reviewedCaptions?.length === rawCaptions.length
          ? "agent"
          : "asr-only",
    },
    visual: visual.visual,
    artifacts: { directory, transcriptPath, transcriptTextPath, pedagogyPath, captionsPath, planPath },
  };
  await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  await writeFile(transcriptTextPath, `${toPlainTranscript(transcript)}\n`, "utf8");
  await writeFile(pedagogyPath, `${JSON.stringify(pedagogy, null, 2)}\n`, "utf8");
  await writeFile(captionsPath, toSrt(captions), "utf8");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await mkdir(ROOT, { recursive: true });
  await writeFile(LATEST_PATH, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await analysisStatusWrite;
  await writeAnalysisStatus({
    status: "completed",
    requestId: input.requestId,
    sourcePath: input.sourcePath,
    startedAt,
    progress: 100,
    stage: "Análise e planejamento concluídos.",
    completedAt: new Date().toISOString(),
    planId: plan.id,
  });
  return plan;
  } catch (error) {
    await writeAnalysisStatus({
      status: "failed",
      requestId: input.requestId,
      sourcePath: input.sourcePath,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function sharedIdentityEvents(
  plan: IntelligentEditPlan,
  identity: IntelligentCourseIdentity,
  lessonIndex: number,
) {
  const motion = resolveMotionProfile(plan.motion?.pace, plan.style);
  const lesson = identity.lessons[lessonIndex - 1];
  const nextLesson = identity.lessons[lessonIndex];
  const generatedHighlights = narrativeHighlights(
    plan.transcript,
    plan.media.durationSeconds,
  );
  const preserved = plan.events.filter((event) => {
    if (event.kind === "intro" || event.kind === "outro") return false;
    if (event.id === "lower-third-start") return false;
    return !(plan.semantic.source === "deterministic-fallback" && event.kind === "impact-text");
  });
  if (plan.semantic.source === "deterministic-fallback") {
    preserved.push(...generatedHighlights.map((highlight, index) => ({
      id: `impact-text-${index + 1}`,
      kind: "impact-text" as const,
      start: highlight.time,
      duration: motion.impactDuration,
      label: highlight.text,
      variant: highlight.variant,
      reason: "Síntese semântica compartilhada do módulo.",
    })));
  }
  return composeMotionEvents([
    ...preserved,
    {
      id: "intro",
      kind: "intro" as const,
      start: 0,
      duration: motion.cardDuration,
      label: lesson.title,
      subtitle: lesson.subtitle,
      reason: "Abertura padronizada pela identidade semântica do módulo.",
    },
    {
      id: "lower-third-start",
      kind: "lower-third" as const,
      start: 0.6,
      duration: motion.lowerThirdDuration,
      label: `${identity.title} • ${lesson.title}`.slice(0, 100),
      reason: "Identificação consistente da série e da aula.",
    },
    {
      id: "outro",
      kind: "outro" as const,
      start: plan.media.durationSeconds,
      duration: motion.cardDuration,
      label: nextLesson
        ? `Próxima aula\n${nextLesson.title.replace(" · ", ": ")}`.slice(0, 72)
        : "Plano concluído",
      subtitle: nextLesson?.subtitle || identity.promise,
      reason: "Encerramento conectado à progressão do módulo.",
    },
  ], plan.media.durationSeconds, motion);
}

export async function applyCourseIdentity(
  plan: IntelligentEditPlan,
  identity: IntelligentCourseIdentity,
  lessonIndex: number,
) {
  const lesson = identity.lessons[lessonIndex - 1];
  if (!lesson) throw new Error("A identidade do curso não contém esta aula.");
  const transcript = plan.transcript.map((segment) => segment.text).join("\n");
  const theme = await resolveCourseTheme({
    courseName: identity.title,
    transcript,
    rationale: `Identidade visual compartilhada da série ${identity.title}.`,
    tone: identity.layout === "roadmap"
      ? "progressivo, enérgico e orientado à evolução"
      : undefined,
    reuse: true,
  });
  const updated: IntelligentEditPlan = {
    ...plan,
    courseName: identity.title,
    moduleName: lesson.title,
    lessonNumber: String(lessonIndex),
    lessonName: lesson.title,
    courseIdentity: {
      ...identity,
      lessonIndex,
      lessonTotal: identity.lessons.length,
    },
    courseTheme: { ...theme.profile, reused: theme.reused },
    design: courseThemeDesign(
      theme.profile,
      plan.design?.captionsEnabled !== false,
    ),
  };
  updated.events = sharedIdentityEvents(updated, identity, lessonIndex);
  await writeFile(updated.artifacts.planPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await writeFile(LATEST_PATH, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

export async function loadIntelligentEditPlan(planId?: string) {
  if (planId && !/^[a-f0-9]{16}$/.test(planId)) {
    throw new Error("Identificador da análise inteligente inválido.");
  }
  const filePath = planId
    ? path.join(ROOT, planId, "intelligent-edit-plan.json")
    : LATEST_PATH;
  return readFile(filePath, "utf8")
    .then((raw) => JSON.parse(raw) as IntelligentEditPlan)
    .catch(() => null);
}

export async function readIntelligentEditPlan(planId?: string) {
  const plan = await loadIntelligentEditPlan(planId);
  if (!plan) return null;
  const { applyEditorialReview, readEditorialReview } = await import("./intelligent-edit.review");
  return applyEditorialReview(plan, await readEditorialReview(plan));
}

export async function clearVideoEditorCache(_input?: Record<string, unknown>) {
  const baseDir = path.join(getLocalDataDir(), "davinci-resolve-free");
  const root = path.join(baseDir, "intelligent");
  const latestPath = path.join(root, "latest-analysis.json");
  const analysisStatusPath = path.join(root, "analysis-status.json");
  const renderStatusPath = path.join(root, "render-status.json");
  const pendingPath = path.join(baseDir, "pending-plan.json");
  const sourceWaveformsDir = path.join(baseDir, "source-waveforms");
  const webUploadsDir = path.join(baseDir, "web-uploads");

  await Promise.allSettled([
    unlink(latestPath),
    unlink(analysisStatusPath),
    unlink(renderStatusPath),
    unlink(pendingPath),
    rm(sourceWaveformsDir, { recursive: true, force: true }),
    rm(webUploadsDir, { recursive: true, force: true }),
  ]);

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.allSettled(
    entries
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name))
      .map((entry) => rm(path.join(root, entry.name), { recursive: true, force: true })),
  );

  return {
    cleared: true,
    message: "Cache do editor de vídeo limpo com sucesso.",
  };
}
