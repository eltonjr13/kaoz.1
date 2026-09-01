import crypto from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { createDavinciFreePlan } from "./davinci-free.service";
import {
  type IntelligentCaption,
  type IntelligentCaptionPreset,
  type IntelligentEditDesign,
  type IntelligentEditEvent,
  type IntelligentEditPlan,
} from "./intelligent-edit.types";
import { resolveIntelligentEditDesign } from "./intelligent-edit.design";
import { resolveMotionProfile } from "./intelligent-edit.motion";
import { readIntelligentEditPlan } from "./intelligent-edit.service";
import { recordEditorialPreview } from "./intelligent-edit.review";
import { ensureSfxLibrary } from "./sfx.service";
import {
  normalizeVideoOutputResolution,
  resolveVideoOutputDimensions,
} from "./video-output-resolution";
import {
  normalizeVideoEncoderPreference,
  videoEncoderArguments,
  type VideoEncoder,
  type VideoEncoderOptions,
} from "./video-encoder";
import {
  estimateVideoExportBytes,
  normalizeVideoExportProfile,
  proxyVideoProfile,
  resolveVideoExportProfile,
  type ResolvedVideoExportProfile,
  type VideoExportProfile,
} from "./video-export-profile";
import { formattedLessonNumber } from "./lesson-download";
import { karaokeCaptionSlices } from "./caption-karaoke";
import {
  editedVideoDuration,
  editedVideoTime,
  videoCutRanges,
  videoCutSelectExpression,
} from "./video-cuts";

function ffmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH?.trim(),
    ffmpegStaticPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) || "ffmpeg";
}

const RENDER_STATUS_PATH = path.join(
  getLocalDataDir(),
  "davinci-resolve-free",
  "intelligent",
  "render-status.json",
);

export type IntelligentRenderStatus = {
  status: "running" | "completed" | "failed";
  planId: string;
  progress: number;
  stage: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
};

async function writeRenderStatus(status: IntelligentRenderStatus) {
  await mkdir(path.dirname(RENDER_STATUS_PATH), { recursive: true });
  await writeFile(RENDER_STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function readIntelligentRenderStatus(): Promise<IntelligentRenderStatus | null> {
  return readFile(RENDER_STATUS_PATH, "utf8")
    .then((raw) => JSON.parse(raw) as IntelligentRenderStatus)
    .catch(() => null);
}

function runFfmpeg(
  args: string[],
  timeoutMs = 60 * 60_000,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-progress", "pipe:2", "-nostats", ...args], { windowsHide: true });
    const stderr: Buffer[] = [];
    let progressOutput = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      child.kill();
      if (process.platform === "win32" && child.pid) {
        const pid = child.pid;
        setTimeout(() => {
          if (child.exitCode === null) spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
        }, 3_000).unref();
      }
      finish(() => reject(new DOMException("Renderização cancelada.", "AbortError")));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("Render excedeu o limite de tempo.")));
    }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (!onProgress) return;
      progressOutput = `${progressOutput}${chunk.toString("utf8")}`;
      const lines = progressOutput.split(/\r?\n/);
      progressOutput = lines.pop() || "";
      for (const line of lines) {
        const match = /^out_time_us=(\d+)$/.exec(line.trim());
        if (match) onProgress(Number(match[1]) / 1_000_000);
      }
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg falhou (${code}): ${Buffer.concat(stderr).toString("utf8").slice(-1_200)}`));
      });
    });
  });
}

export type RenderExecutionOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: number, stage: string) => void;
};

let amdAmfProbe: Promise<boolean> | undefined;

function supportsAmdAmf() {
  amdAmfProbe ||= runFfmpeg([
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "color=c=black:s=640x360:r=30:d=0.1",
    "-frames:v", "1",
    "-c:v", "h264_amf",
    "-quality", "speed",
    "-f", "null",
    "-",
  ], 15_000).then(() => true).catch(() => false);
  return amdAmfProbe;
}

async function selectVideoEncoder(preference: unknown): Promise<VideoEncoder> {
  if (normalizeVideoEncoderPreference(preference) === "cpu") return "libx264";
  return await supportsAmdAmf() ? "amd-amf" : "libx264";
}

function assTime(seconds: number) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replace(/\r?\n/g, "\\N")
    .trim();
}

function wrapCaption(value: string) {
  const words = value.split(/\s+/);
  if (value.length <= 42 || words.length < 5) return value;
  let bestIndex = Math.floor(words.length / 2);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 2; index < words.length - 1; index += 1) {
    const distance = Math.abs(words.slice(0, index).join(" ").length - value.length / 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return `${words.slice(0, bestIndex).join(" ")}\n${words.slice(bestIndex).join(" ")}`;
}

function wrapCardTitle(value: string) {
  if (value.includes("\n")) return value;
  const words = value.split(/\s+/);
  if (value.length <= 30 || words.length < 3) return value;
  let split = Math.ceil(words.length / 2);
  while (split > 2 && words.slice(0, split).join(" ").length > 34) {
    split -= 1;
  }
  return `${words.slice(0, split).join(" ")}\n${words.slice(split).join(" ")}`;
}

function assColor(hex: string, alpha = "00") {
  const normalized = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const [red, green, blue] = normalized.match(/.{2}/g) || ["FF", "FF", "FF"];
  return `&H${alpha}${blue}${green}${red}`.toUpperCase();
}

function assHeader(plan: IntelligentEditPlan) {
  const { colors } = resolveIntelligentEditDesign(plan);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${plan.media.width}`,
    `PlayResY: ${plan.media.height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,Segoe UI,54,${assColor(colors.text)},&H000000FF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,3,1,2,90,90,62,1`,
    `Style: CaptionHormozi,Arial Black,58,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,70,1`,
    `Style: CaptionKaraoke,Segoe UI Black,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H88000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,65,1`,
    `Style: CaptionKaraokeFill,Segoe UI Black,56,&H88FFFFFF,&H00FFFFFF,&H00000000,&H88000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,65,1`,
    `Style: CaptionKaraokePop,Arial Black,58,&HCCFFFFFF,&H00FFFFFF,&H00000000,&H88000000,-1,0,0,0,100,100,0,0,1,5,2,2,78,78,65,1`,
    `Style: CaptionKaraokeNeon,Arial Black,56,&H99FFFFFF,&H00FFFFFF,&H00FF6430,&H780D0712,-1,0,0,0,100,100,1,0,1,3,2,2,80,80,66,1`,
    `Style: CaptionKaraokeBox,Arial Black,54,&H00111111,&H00FFFFFF,&H00000000,${assColor(colors.primary)},-1,0,0,0,100,100,0,0,3,1,0,2,82,82,66,1`,
    `Style: CaptionClean,Segoe UI Semibold,46,${assColor(colors.text)},&H000000FF,&H0018181B,&HA0000000,-1,0,0,0,100,100,0,0,1,1,0,2,100,100,55,1`,
    `Style: CaptionNeon,Arial Black,54,&H00FFF4D8,&H00FFFFFF,&H00FF6430,&H780D0712,-1,0,0,0,100,100,1,0,1,3,2,2,80,80,66,1`,
    `Style: CaptionBoxed,Arial Black,52,&H00111111,&H00FFFFFF,&H00000000,${assColor(colors.secondary || "#FFE600")},-1,0,0,0,100,100,0,0,3,1,0,2,88,88,66,1`,
    `Style: CaptionOutline,Arial Black,55,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,6,1,2,82,82,64,1`,
    `Style: CaptionHighlight,Segoe UI Black,54,&H00FFFFFF,&H00FFFFFF,&H00111111,&H78000000,-1,0,0,0,100,100,0,0,1,4,1,2,82,82,66,1`,
    `Style: LowerThird,Segoe UI Semibold,40,${assColor(colors.text)},&H000000FF,${assColor(colors.background, "20")},${assColor(colors.surface, "35")},-1,0,0,0,100,100,0,0,1,2,1,1,70,70,105,1`,
    `Style: ImpactBox,Segoe UI,10,${assColor(colors.surface)},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: ImpactIcon,Segoe UI Semibold,24,${assColor(colors.primary)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,5,0,0,0,1`,
    `Style: ImpactMeta,Segoe UI Semibold,18,${assColor(colors.muted)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,4,0,0,0,1`,
    `Style: ImpactText,Segoe UI Semibold,42,${assColor(colors.text)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1`,
    `Style: CardKicker,Segoe UI Semibold,22,${assColor(colors.primary)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,3,0,1,0,0,7,80,80,80,1`,
    `Style: CardTitle,Segoe UI Semibold,66,${assColor(colors.text)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,-1,0,1,0,0,4,80,80,80,1`,
    `Style: CardSubtitle,Segoe UI,30,${assColor(colors.muted)},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,4,80,80,80,1`,
    `Style: CardIndex,Segoe UI Semibold,21,${assColor(colors.secondary)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,4,80,80,80,1`,
    `Style: CardNumber,Segoe UI Semibold,170,${assColor(colors.muted, "C8")},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,-4,0,1,0,0,5,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

type ImpactLayout = {
  event: IntelligentEditEvent;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  accent: string;
  icon: string;
  label: string;
  fontSize: number;
  meta: string;
};

function impactLayouts(plan: IntelligentEditPlan): ImpactLayout[] {
  const design = resolveIntelligentEditDesign(plan);
  const layouts: ImpactLayout[] = [];
  let previousImpactEnd = Number.NEGATIVE_INFINITY;
  for (const event of plan.events.filter((item) => item.kind === "impact-text")) {
    const overlappingLowerThird = plan.events.find(
      (candidate) =>
        candidate.kind === "lower-third" &&
        event.start < candidate.start + candidate.duration &&
        event.start + event.duration > candidate.start,
    );
    const desiredStart = overlappingLowerThird
      ? Math.min(
          plan.media.durationSeconds - event.duration,
          overlappingLowerThird.start + overlappingLowerThird.duration + 0.2,
        )
      : event.start;
    const start = Math.min(
      plan.media.durationSeconds - event.duration,
      Math.max(desiredStart, previousImpactEnd + 0.25),
    );
    const end = start + event.duration;
    previousImpactEnd = end;
    const focal = plan.events
      .filter(
        (candidate) =>
          (candidate.kind === "zoom" || candidate.kind === "cut") &&
          candidate.x !== undefined,
      )
      .sort((left, right) => Math.abs(left.start - start) - Math.abs(right.start - start))[0];
    const placeLeft = (focal?.x ?? 0.5) >= 0.48;
    const accent =
      event.variant === "action" || event.variant === "stat"
        ? design.colors.secondary
        : design.colors.primary;
    const decoratedLabel =
      event.variant === "quote"
        ? `“${event.label}”`
        : event.variant === "stat"
          ? event.label.toUpperCase()
          : event.label;
    const fontSize =
      event.variant === "stat"
        ? 50
        : event.variant === "quote" || event.label.length > 26
          ? 38
          : 43;
    const shouldWrap = decoratedLabel.length > 30;
    let label = decoratedLabel;
    if (shouldWrap) {
      const words = decoratedLabel.split(/\s+/);
      let split = 1;
      let smallestDifference = Number.POSITIVE_INFINITY;
      for (let index = 1; index < words.length; index += 1) {
        const difference = Math.abs(
          words.slice(0, index).join(" ").length -
          words.slice(index).join(" ").length,
        );
        if (difference < smallestDifference) {
          smallestDifference = difference;
          split = index;
        }
      }
      label = `${words.slice(0, split).join(" ")}\n${words.slice(split).join(" ")}`;
    }
    const longestLine = Math.max(...label.split("\n").map((line) => line.length));
    const height = shouldWrap ? 142 : event.variant === "stat" ? 118 : 104;
    const width = Math.max(
      460,
      Math.min(760, Math.round(longestLine * fontSize * 0.52 + 150)),
    );
    const margin = Math.round(plan.media.width * 0.057);
    const x = placeLeft ? margin : plan.media.width - margin - width;
    layouts.push({
      event,
      start,
      end,
      x,
      y: Math.round(
        plan.media.height * (event.variant === "action" ? 0.16 : 0.085),
      ),
      width,
      height,
      accent,
      icon: event.variant === "action" ? "GO" : event.variant === "stat" ? "01" : "•",
      label,
      fontSize,
      meta:
        event.variant === "action"
          ? "PRÓXIMA AÇÃO"
          : event.variant === "stat"
            ? "MARCO"
            : event.variant === "quote"
              ? "IDEIA-CHAVE"
              : "CONCEITO",
    });
  }
  return layouts;
}

const CONTEXTUAL_EMOJIS: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /\b(dinheiro|faturamento|lucro|vendas|pagamento|comissao|comissão|grana|investimento)\b/i, emoji: "💰" },
  { pattern: /\b(foguete|crescimento|crescer|escalar|escala|avancar|avançar|rapido|rápido|decolar)\b/i, emoji: "🚀" },
  { pattern: /\b(atencao|atenção|cuidado|alerta|perigo|erro|falha|aviso)\b/i, emoji: "⚠️" },
  { pattern: /\b(ideia|sacada|dica|insight|pensar|criatividade|visao|visão)\b/i, emoji: "💡" },
  { pattern: /\b(meta|foco|objetivo|alvo|estrategia|estratégia|resultado)\b/i, emoji: "🎯" },
  { pattern: /\b(fogo|viral|incrivel|incrível|demais|show|top|sucesso)\b/i, emoji: "🔥" },
  { pattern: /\b(codigo|código|programar|tecnologia|software|sistema|ia|computador)\b/i, emoji: "⚡" },
  { pattern: /\b(tempo|rapido|rápido|hora|segundo|cronometro|cronômetro|prazo)\b/i, emoji: "⏱️" },
];

function injectContextualEmojis(text: string): string {
  let enriched = text;
  for (const item of CONTEXTUAL_EMOJIS) {
    if (item.pattern.test(enriched) && !enriched.includes(item.emoji)) {
      enriched = `${enriched} ${item.emoji}`;
      break;
    }
  }
  return enriched;
}

function karaokeCaptionText(
  words: string[],
  activeIndex: number,
  completedIndex: number,
  preset: IntelligentCaptionPreset,
  colors: IntelligentEditDesign["colors"],
) {
  const shouldWrap = words.join(" ").length > 42 && words.length >= 5;
  const middle = shouldWrap ? Math.ceil(words.length / 2) : -1;
  const styleName = karaokeStyleName(preset);
  return words.map((word, index) => {
    const separator = index === middle ? "\\N" : index > 0 ? " " : "";
    const safeWord = assText(word);
    if (index !== activeIndex) {
      if (preset === "karaoke-fill" && index <= completedIndex) {
        return `${separator}{\\1c${assColor(colors.secondary)}}${safeWord}{\\r${styleName}}`;
      }
      if (preset === "karaoke-neon" && index <= completedIndex) {
        return `${separator}{\\1c${assColor(colors.primary)}\\blur0.8}${safeWord}{\\r${styleName}}`;
      }
      if (preset === "karaoke-box" && index <= completedIndex) {
        return `${separator}{\\alpha&H55&}${safeWord}{\\r${styleName}}`;
      }
      return `${separator}${safeWord}`;
    }
    if (preset === "karaoke-pop") {
      return `${separator}{\\1c${assColor(colors.secondary)}\\bord7\\fscx124\\fscy124\\t(0,120,\\fscx112\\fscy112)}${safeWord}{\\r${styleName}}`;
    }
    if (preset === "karaoke-neon") {
      return `${separator}{\\1c&H00FFFFCC&\\3c&H00FFFF00&\\bord7\\blur2}${safeWord}{\\r${styleName}}`;
    }
    if (preset === "karaoke-box") {
      return `${separator}{\\1c&H00FFFFFF&\\3c&H00101010&\\bord3\\fscx108\\fscy108}${safeWord}{\\r${styleName}}`;
    }
    const accent = preset === "karaoke-fill" ? colors.secondary : colors.primary;
    return `${separator}{\\1c${assColor(accent)}\\bord6\\blur0.4}${safeWord}{\\r${styleName}}`;
  }).join("");
}

function karaokeStyleName(preset: IntelligentCaptionPreset) {
  if (preset === "karaoke-fill") return "CaptionKaraokeFill";
  if (preset === "karaoke-pop") return "CaptionKaraokePop";
  if (preset === "karaoke-neon") return "CaptionKaraokeNeon";
  if (preset === "karaoke-box") return "CaptionKaraokeBox";
  return "CaptionKaraoke";
}

export function karaokeCaptionEvents(
  caption: IntelligentCaption,
  colors: IntelligentEditDesign["colors"],
  useEmojis: boolean,
  preset: IntelligentCaptionPreset = "karaoke",
) {
  const displayText = useEmojis ? injectContextualEmojis(caption.text) : caption.text;
  return karaokeCaptionSlices(caption, displayText).map((slice) => {
    const styleName = karaokeStyleName(preset);
    const text = karaokeCaptionText(slice.words, slice.activeIndex, slice.completedIndex, preset, colors);
    return `Dialogue: 0,${assTime(slice.start)},${assTime(slice.end)},${styleName},,0,0,0,,${text}`;
  });
}

function formatPresetCaption(
  rawText: string,
  preset: IntelligentEditDesign["captionPreset"],
  colors: IntelligentEditDesign["colors"],
  useEmojis: boolean,
): { styleName: string; formattedText: string } {
  const text = useEmojis ? injectContextualEmojis(rawText) : rawText;

  if (preset === "hormozi") {
    const uppercaseText = text.toUpperCase();
    const words = uppercaseText.split(/\s+/);
    const highlighted = words.map((w, i) => {
      if (i % 2 === 1 && w.length > 2) {
        return `{\\1c${assColor(colors.secondary || "#FFE600")}&}${w}{\\1c&H00FFFFFF&}`;
      }
      return w;
    }).join(" ");
    return {
      styleName: "CaptionHormozi",
      formattedText: `{\\fscx106\\fscy106\\t(0,90,\\fscx100\\fscy100)}${assText(wrapCaption(highlighted))}`,
    };
  }

  if (preset === "clean") {
    return {
      styleName: "CaptionClean",
      formattedText: assText(wrapCaption(text)),
    };
  }

  if (preset === "neon") {
    return {
      styleName: "CaptionNeon",
      formattedText: `{\\blur1\\fscx104\\fscy104\\t(0,120,\\fscx100\\fscy100)}${assText(wrapCaption(text.toUpperCase()))}`,
    };
  }

  if (preset === "boxed") {
    return {
      styleName: "CaptionBoxed",
      formattedText: `{\\fsp1}${assText(wrapCaption(text.toUpperCase()))}`,
    };
  }

  if (preset === "outline") {
    return {
      styleName: "CaptionOutline",
      formattedText: assText(wrapCaption(text.toUpperCase())),
    };
  }

  if (preset === "highlight") {
    const words = text.split(/\s+/).filter(Boolean);
    const highlightedIndex = words.reduce(
      (best, word, index) => word.length > (words[best]?.length || 0) ? index : best,
      0,
    );
    const formattedText = words.map((word, index) => {
      const safeWord = assText(word);
      if (index !== highlightedIndex) return safeWord;
      return `{\\1c${assColor(colors.secondary || "#FFE600")}\\fscx108\\fscy108}${safeWord}{\\1c&H00FFFFFF&\\fscx100\\fscy100}`;
    }).join(" ");
    return {
      styleName: "CaptionHighlight",
      formattedText,
    };
  }

  return {
    styleName: "Caption",
    formattedText: assText(wrapCaption(text)),
  };
}

function bodyAss(plan: IntelligentEditPlan) {
  const design = resolveIntelligentEditDesign(plan);
  const motion = resolveMotionProfile(plan.motion?.pace, plan.style);
  const lines = [assHeader(plan)];
  if (design.captionsEnabled) {
    const preset = design.captionPreset || "hormozi";
    const useEmojis = design.captionEmojis !== false;
    for (const caption of plan.captions) {
      if (preset.startsWith("karaoke")) {
        lines.push(...karaokeCaptionEvents(caption, design.colors, useEmojis, preset));
        continue;
      }
      const { styleName, formattedText } = formatPresetCaption(
        caption.text,
        preset,
        design.colors,
        useEmojis,
      );
      lines.push(
        `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},${styleName},,0,0,0,,${formattedText}`,
      );
    }
  }
  for (const event of plan.events.filter((item) => item.kind === "lower-third")) {
    const enterMs = Math.round(Math.min(motion.entranceSeconds, event.duration * 0.28) * 1000);
    const exitMs = Math.round(Math.min(motion.exitSeconds, event.duration * 0.22) * 1000);
    lines.push(
      `Dialogue: 1,${assTime(event.start)},${assTime(event.start + event.duration)},LowerThird,,0,0,0,,{\\fad(${enterMs},${exitMs})\\move(-650,${Math.round(plan.media.height * 0.86)},70,${Math.round(plan.media.height * 0.86)},0,${enterMs})\\1c${assColor(design.colors.primary)}&}▌{\\1c${assColor(design.colors.text)}&} ${assText(event.label)}`,
    );
  }
  for (const layout of impactLayouts(plan)) {
    const centerY = layout.y + Math.round(layout.height / 2);
    const enterMs = Math.round(Math.min(motion.entranceSeconds, layout.event.duration * 0.28) * 1000);
    const exitMs = Math.round(Math.min(motion.exitSeconds, layout.event.duration * 0.22) * 1000);
    const rectangle = (x: number, y: number, width: number, height: number, color: string, alpha = "00") =>
      `Dialogue: 1,${assTime(layout.start)},${assTime(layout.end)},ImpactBox,,0,0,0,,{\\an7\\pos(${x},${y})\\fad(${enterMs},${exitMs})\\1c${assColor(color, alpha)}&\\p1}m 0 0 l ${width} 0 l ${width} ${height} l 0 ${height}{\\p0}`;
    lines.push(
      rectangle(layout.x + 10, layout.y + 10, layout.width, layout.height, "#000000", "C8"),
      rectangle(layout.x, layout.y, layout.width, layout.height, design.colors.surface, "14"),
      rectangle(layout.x, layout.y, layout.event.variant === "quote" ? 7 : 5, layout.height, layout.accent),
      rectangle(layout.x + 18, layout.y + Math.round((layout.height - 54) / 2), 54, 54, design.colors.background, "28"),
      rectangle(layout.x + 92, layout.y + 45, Math.min(120, layout.width - 120), 2, layout.accent, "48"),
    );
    lines.push(
      `Dialogue: 2,${assTime(layout.start)},${assTime(layout.end)},ImpactIcon,,0,0,0,,{\\pos(${layout.x + 44},${centerY})\\fad(${enterMs},${exitMs})\\1c${assColor(layout.accent)}&}${assText(layout.icon)}`,
    );
    lines.push(
      `Dialogue: 2,${assTime(layout.start)},${assTime(layout.end)},ImpactMeta,,0,0,0,,{\\an4\\move(${layout.x + 88},${layout.y + 27},${layout.x + 98},${layout.y + 27},0,${enterMs})\\fad(${enterMs},${exitMs})\\1c${assColor(layout.accent)}&}${assText(layout.meta)}`,
    );
    lines.push(
      `Dialogue: 2,${assTime(layout.start)},${assTime(layout.end)},ImpactText,,0,0,0,,{\\an4\\move(${layout.x + 88},${centerY + 13},${layout.x + 98},${centerY + 13},0,${enterMs})\\fad(${enterMs},${exitMs})\\fs${layout.fontSize}}${assText(layout.label)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function titleAss(
  plan: IntelligentEditPlan,
  kind: "intro" | "outro",
) {
  const motion = resolveMotionProfile(plan.motion?.pace, plan.style);
  const event = plan.events.find((item) => item.kind === kind);
  const duration = event?.duration || 4;
  const title = event?.label || (kind === "intro" ? plan.moduleName : "Próxima aula");
  const subtitle =
    event?.subtitle || (kind === "intro"
      ? plan.courseName || "Curso"
      : plan.courseName || plan.moduleName);
  const identity = plan.courseIdentity;
  const kicker = kind === "intro"
    ? identity
      ? `${identity.eyebrow}  /  ${identity.title}`
      : plan.courseName || "NESTA AULA"
    : identity?.title || "PRÓXIMO PASSO";
  const number = formattedLessonNumber(plan.lessonNumber)
    || (identity ? String(identity.lessonIndex).padStart(2, "0") : "01");
  const index = kind === "intro" && identity
    ? `AULA ${number}  /  ${String(identity.lessonTotal).padStart(2, "0")}`
    : kind === "outro"
      ? "ENCERRAMENTO"
      : `AULA ${number}`;
  const enterMs = Math.round(motion.entranceSeconds * 1000);
  const exitMs = Math.round(motion.exitSeconds * 1000);
  const titleScaleMs = Math.round(motion.entranceSeconds * 1_000);
  return [
    assHeader(plan),
    `Dialogue: 0,${assTime(0.2)},${assTime(duration - motion.exitSeconds)},CardKicker,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.22)})\\fad(${enterMs},${exitMs})}${assText(kicker.toUpperCase())}`,
    `Dialogue: 0,${assTime(0.48)},${assTime(duration - motion.exitSeconds)},CardTitle,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.43)})\\fad(${enterMs},${exitMs})\\fscx94\\fscy94\\t(0,${titleScaleMs},1,\\fscx100\\fscy100)}${assText(wrapCardTitle(title))}`,
    `Dialogue: 0,${assTime(0.98)},${assTime(duration - motion.exitSeconds)},CardSubtitle,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.63)})\\fad(${enterMs},${exitMs})}${assText(subtitle)}`,
    `Dialogue: 0,${assTime(1.28)},${assTime(duration - motion.exitSeconds)},CardIndex,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.78)})\\fad(${enterMs},${exitMs})}${assText(index)}`,
    `Dialogue: 0,${assTime(0.36)},${assTime(duration - motion.exitSeconds)},CardNumber,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.85)},${Math.round(plan.media.height * 0.47)})\\fad(${enterMs},${exitMs})}${assText(number)}`,
    "",
  ].join("\n");
}

function filterPath(filePath: string) {
  return filePath.replaceAll("\\", "/").replace(":", "\\:");
}

function scaleExpression(events: IntelligentEditEvent[]) {
  const animatedEvents = events.filter((event) => event.kind === "zoom" || event.kind === "cut");
  const zoomExpressions = animatedEvents
    .map((event) => {
      const peak = Math.max(1.025, Math.min(1.14, event.scale || (event.kind === "cut" ? 1.055 : 1.09)));
      const delta = peak - 1;
      const entry = Math.max(0.4, Math.min(0.8, event.duration * 0.28));
      const exit = Math.max(0.35, Math.min(0.65, event.duration * 0.24));
      const start = event.start.toFixed(3);
      const rampEnd = (event.start + entry).toFixed(3);
      const holdEnd = (event.start + Math.max(entry, event.duration - exit)).toFixed(3);
      const end = (event.start + event.duration).toFixed(3);
      const enterProgress = `(t-${start})/${entry.toFixed(3)}`;
      const exitProgress = `(t-${holdEnd})/${exit.toFixed(3)}`;
      const enterEase = `(${enterProgress})*(${enterProgress})*(3-2*(${enterProgress}))`;
      const exitEase = `(${exitProgress})*(${exitProgress})*(3-2*(${exitProgress}))`;
      return `if(between(t,${start},${rampEnd}),1+${delta.toFixed(4)}*(${enterEase}),if(between(t,${rampEnd},${holdEnd}),${peak.toFixed(4)},if(between(t,${holdEnd},${end}),${peak.toFixed(4)}-${delta.toFixed(4)}*(${exitEase}),1)))`;
    });
  return zoomExpressions.length ? zoomExpressions.reduce((left, right) => `max(${left},${right})`) : "1";
}

function focalExpression(events: IntelligentEditEvent[], axis: "x" | "y") {
  const zoomEvents = events.filter((event) => event.kind === "zoom");
  const candidates = events.filter(
    (event) => event.kind === "cut" && event[axis] !== undefined,
  );
  const defaultValue = axis === "x" ? "(in_w-out_w)/2" : "(in_h-out_h)/2";
  const inputSize = axis === "x" ? "in_w" : "in_h";
  const outputSize = axis === "x" ? "out_w" : "out_h";
  let expression = defaultValue;
  for (const event of [...candidates, ...zoomEvents].reverse()) {
    const coordinate = Math.max(0, Math.min(1, event[axis] ?? 0.5)).toFixed(4);
    const focused = `${coordinate}*${inputSize}-${outputSize}/2`;
    const entry = Math.max(0.4, Math.min(0.8, event.duration * 0.28));
    const exit = Math.max(0.35, Math.min(0.65, event.duration * 0.24));
    const start = event.start.toFixed(3);
    const rampEnd = (event.start + entry).toFixed(3);
    const holdEnd = (event.start + Math.max(entry, event.duration - exit)).toFixed(3);
    const end = (event.start + event.duration).toFixed(3);
    const enterProgress = `(t-${start})/${entry.toFixed(3)}`;
    const exitProgress = `(t-${holdEnd})/${exit.toFixed(3)}`;
    const enterEase = `(${enterProgress})*(${enterProgress})*(3-2*(${enterProgress}))`;
    const exitEase = `1-((${exitProgress})*(${exitProgress})*(3-2*(${exitProgress})))`;
    const entering = `${defaultValue}+((${focused})-(${defaultValue}))*(${enterEase})`;
    const exiting = `${defaultValue}+((${focused})-(${defaultValue}))*(${exitEase})`;
    expression = `if(between(t,${start},${rampEnd}),${entering},if(between(t,${rampEnd},${holdEnd}),${focused},if(between(t,${holdEnd},${end}),${exiting},${expression})))`;
  }
  return `max(0,min(${inputSize}-${outputSize},${expression}))`;
}

function transitionExpression(events: IntelligentEditEvent[]) {
  const expressions = events
    .filter((event) => event.kind === "transition")
    .map((event) => {
      const half = Math.max(0.12, event.duration / 2);
      const start = Math.max(0, event.start - half);
      const middle = event.start;
      const end = event.start + half;
      const enterProgress = `(t-${start.toFixed(3)})/${half.toFixed(3)}`;
      const exitProgress = `(t-${middle.toFixed(3)})/${half.toFixed(3)}`;
      const enterEase = `(${enterProgress})*(${enterProgress})*(3-2*(${enterProgress}))`;
      const exitEase = `1-((${exitProgress})*(${exitProgress})*(3-2*(${exitProgress})))`;
      return `if(between(t,${start.toFixed(3)},${middle.toFixed(3)}),${enterEase},if(between(t,${middle.toFixed(3)},${end.toFixed(3)}),${exitEase},0))`;
    });
  return expressions.length
    ? expressions.reduce((left, right) => `max(${left},${right})`)
    : "0";
}

function bodyVideoFilter(plan: IntelligentEditPlan, assPath: string) {
  const motion = resolveMotionProfile(plan.motion?.pace, plan.style);
  const scale = scaleExpression(plan.events);
  const focusX = focalExpression(plan.events, "x");
  const focusY = focalExpression(plan.events, "y");
  const transition = transitionExpression(plan.events);
  const filters = [
    `scale=${plan.media.width}:${plan.media.height}:flags=lanczos`,
    `scale=w='trunc(iw*(${scale})/2)*2':h='trunc(ih*(${scale})/2)*2':eval=frame`,
    `crop=${plan.media.width}:${plan.media.height}:x='${focusX}':y='${focusY}'`,
    `eq=contrast=1.025:saturation=1.05:gamma=1.0:brightness='-${motion.transitionDarkness.toFixed(3)}*(${transition})':eval=frame`,
  ];
  filters.push(`ass='${filterPath(assPath)}'`);
  for (const event of plan.events.filter(
    (item) => item.kind === "cursor" && item.x !== undefined && item.y !== undefined,
  )) {
    const size = Math.max(36, Math.round(Math.min(plan.media.width, plan.media.height) * 0.055));
    filters.push(
      `drawbox=x=${Math.round(event.x! - size / 2)}:y=${Math.round(event.y! - size / 2)}:w=${size}:h=${size}:color=yellow@0.75:t=4:enable='between(t,${event.start.toFixed(3)},${(event.start + event.duration).toFixed(3)})'`,
    );
  }
  filters.push(
    `fade=t=in:st=0:d=${Math.min(0.55, motion.entranceSeconds).toFixed(3)}`,
    `fade=t=out:st=${Math.max(0, plan.media.durationSeconds - Math.min(0.6, motion.exitSeconds)).toFixed(3)}:d=${Math.min(0.6, motion.exitSeconds).toFixed(3)}`,
  );
  return filters.join(",");
}

function bodyVideoFilterForRange(plan: IntelligentEditPlan, assPath: string, includeBoundaryFades: boolean) {
  if (includeBoundaryFades) return bodyVideoFilter(plan, assPath);
  const motion = resolveMotionProfile(plan.motion?.pace, plan.style);
  const scale = scaleExpression(plan.events);
  const focusX = focalExpression(plan.events, "x");
  const focusY = focalExpression(plan.events, "y");
  const transition = transitionExpression(plan.events);
  const filters = [
    `scale=${plan.media.width}:${plan.media.height}:flags=lanczos`,
    `scale=w='trunc(iw*(${scale})/2)*2':h='trunc(ih*(${scale})/2)*2':eval=frame`,
    `crop=${plan.media.width}:${plan.media.height}:x='${focusX}':y='${focusY}'`,
    `eq=contrast=1.025:saturation=1.05:gamma=1.0:brightness='-${motion.transitionDarkness.toFixed(3)}*(${transition})':eval=frame`,
    `ass='${filterPath(assPath)}'`,
  ];
  return filters.join(",");
}

function cardProgressFilters(
  plan: IntelligentEditPlan,
  kind: "intro" | "outro",
) {
  const identity = plan.courseIdentity;
  if (!identity) return [];
  const { colors } = resolveIntelligentEditDesign(plan);
  const total = Math.min(identity.lessonTotal, 10);
  const active = kind === "outro"
    ? Math.min(identity.lessonIndex + 1, total)
    : identity.lessonIndex;
  const width = Math.round(plan.media.width * 0.12);
  const gap = Math.round(plan.media.height * 0.045);
  const startX = Math.round(plan.media.width * 0.79);
  const startY = Math.round(plan.media.height * 0.68);
  return Array.from({ length: total }, (_, index) => {
    const color = index < active ? colors.primary : colors.muted;
    const alpha = index < active ? "" : "@0.25";
    return `drawbox=x=${startX}:y=${startY + index * gap}:w=${width}:h=4:color=0x${color.slice(1)}${alpha}:t=fill`;
  });
}

function cardFrameworkFilters(
  plan: IntelligentEditPlan,
  kind: "intro" | "outro",
) {
  const identity = plan.courseIdentity;
  if (!identity) return [];
  const { colors } = resolveIntelligentEditDesign(plan);
  const total = Math.min(identity.lessonTotal, 6);
  const active = kind === "outro"
    ? Math.min(identity.lessonIndex + 1, total)
    : identity.lessonIndex;
  const size = Math.round(plan.media.height * 0.055);
  const gap = Math.round(plan.media.width * 0.018);
  const startX = Math.round(plan.media.width * 0.79);
  const startY = Math.round(plan.media.height * 0.67);
  return Array.from({ length: total }, (_, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const color = index < active ? colors.primary : colors.muted;
    const alpha = index < active ? "@0.82" : "@0.16";
    return `drawbox=x=${startX + column * (size + gap)}:y=${startY + row * (size + gap)}:w=${size}:h=${size}:color=0x${color.slice(1)}${alpha}:t=fill`;
  });
}

function cardEditorialFilters(plan: IntelligentEditPlan) {
  const { colors } = resolveIntelligentEditDesign(plan);
  const startX = Math.round(plan.media.width * 0.8);
  const startY = Math.round(plan.media.height * 0.69);
  const gap = Math.round(plan.media.height * 0.05);
  return [0.14, 0.09, 0.12].map((width, index) =>
    `drawbox=x=${startX}:y=${startY + index * gap}:w=${Math.round(plan.media.width * width)}:h=${index === 0 ? 5 : 3}:color=0x${(index === 0 ? colors.primary : colors.muted).slice(1)}@${index === 0 ? "0.82" : "0.28"}:t=fill`,
  );
}

function cardLayoutFilters(
  plan: IntelligentEditPlan,
  kind: "intro" | "outro",
) {
  if (plan.courseIdentity?.layout === "framework") {
    return cardFrameworkFilters(plan, kind);
  }
  if (plan.courseIdentity?.layout === "editorial") {
    return cardEditorialFilters(plan);
  }
  return cardProgressFilters(plan, kind);
}

function audioFilter() {
  return [
    "highpass=f=75",
    "lowpass=f=14500",
    "afftdn=nf=-25",
    "equalizer=f=180:t=q:w=1:g=-2",
    "equalizer=f=3200:t=q:w=1.2:g=2",
    "acompressor=threshold=-18dB:ratio=3:attack=15:release=180:makeup=3dB",
    "alimiter=limit=0.95",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "aresample=48000",
  ].join(",");
}

async function renderCard(
  plan: IntelligentEditPlan,
  kind: "intro" | "outro",
  assPath: string,
  outputPath: string,
  encoder: VideoEncoder,
  onProgress?: (progress: number) => void,
  encoderOptions?: VideoEncoderOptions,
  signal?: AbortSignal,
) {
  const motion = resolveMotionProfile(plan.motion?.pace, plan.style);
  const duration = plan.events.find((item) => item.kind === kind)?.duration || 4;
  const { colors } = resolveIntelligentEditDesign(plan);
  const cardFilter = [
    `drawbox=x=0:y=0:w=iw*0.009:h=ih:color=0x${colors.primary.slice(1)}:t=fill`,
    `drawbox=x=iw*0.72:y=0:w=iw*0.28:h=ih:color=0x${colors.surface.slice(1)}@0.90:t=fill`,
    `drawbox=x=iw*0.08:y=ih*0.13:w=3:h=ih*0.74:color=0x${colors.surface.slice(1)}:t=fill`,
    `drawbox=x=iw*0.11:y=ih*0.28:w=iw*0.065:h=4:color=0x${colors.secondary.slice(1)}:t=fill`,
    `drawbox=x=iw*0.76:y=ih*0.15:w=iw*0.17:h=2:color=0x${colors.muted.slice(1)}@0.24:t=fill`,
    ...cardLayoutFilters(plan, kind),
    `ass='${filterPath(assPath)}'`,
    `fade=t=in:st=0:d=${Math.min(0.65, motion.entranceSeconds).toFixed(3)}`,
    `fade=t=out:st=${(duration - Math.min(0.65, motion.exitSeconds)).toFixed(3)}:d=${Math.min(0.65, motion.exitSeconds).toFixed(3)}`,
  ].join(",");
  await runFfmpeg([
    "-y",
    "-threads",
    "0",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x${colors.background.slice(1)}:s=${plan.media.width}x${plan.media.height}:r=${plan.media.fps.toFixed(3)}:d=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}`,
    "-vf",
    cardFilter,
    "-af",
    `afade=t=in:st=0:d=${Math.min(0.65, motion.entranceSeconds).toFixed(3)},afade=t=out:st=${(duration - Math.min(0.65, motion.exitSeconds)).toFixed(3)}:d=${Math.min(0.65, motion.exitSeconds).toFixed(3)}`,
    "-t",
    duration.toFixed(3),
    ...videoEncoderArguments(encoder, encoderOptions),
    "-c:a",
    "aac",
    "-ar",
    "48000",
    outputPath,
  ], 60 * 60_000, (seconds) => onProgress?.(Math.min(1, seconds / duration)), signal);
}

async function renderBody(
  plan: IntelligentEditPlan,
  assPath: string,
  outputPath: string,
  encoder: VideoEncoder,
  onProgress?: (progress: number) => void,
  encoderOptions?: VideoEncoderOptions,
  signal?: AbortSignal,
  sourceStart = 0,
  includeBoundaryFades = true,
) {
  const select = videoCutSelectExpression(plan.events, plan.media.durationSeconds);
  const videoFilter = [
    bodyVideoFilterForRange(plan, assPath, includeBoundaryFades),
    ...(select ? [`select='${select}'`, "setpts=N/FRAME_RATE/TB"] : []),
  ].join(",");
  const audioFilters = [
    audioFilter(),
    ...(select ? [`aselect='${select}'`, "asetpts=N/SR/TB"] : []),
  ].join(",");
  await runFfmpeg([
    "-y",
    "-threads",
    "0",
    ...(sourceStart > 0 ? ["-ss", sourceStart.toFixed(3)] : []),
    "-i",
    plan.sourcePath,
    ...(sourceStart > 0 ? ["-t", plan.media.durationSeconds.toFixed(3)] : []),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-vf",
    videoFilter,
    "-af",
    audioFilters,
    "-r",
    plan.media.fps.toFixed(3),
    ...videoEncoderArguments(encoder, encoderOptions),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    outputPath,
  ], 60 * 60_000, (seconds) => onProgress?.(Math.min(1, seconds / plan.media.durationSeconds)), signal);
}

function concatFileEntry(filePath: string) {
  const escaped = filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");
  return `file '${escaped}'`;
}

async function writeConcatFile(paths: string[], concatPath: string) {
  await writeFile(concatPath, `${paths.map(concatFileEntry).join("\n")}\n`, "utf8");
}

function sfxFileForEvent(
  event: IntelligentEditEvent,
  paths: Awaited<ReturnType<typeof ensureSfxLibrary>>,
) {
  if (event.kind === "sound-effect" && event.soundEffect) {
    return paths[event.soundEffect];
  }
  if (event.kind === "meme-sfx" || event.memeTag) {
    const tag = (event.memeTag || "vine-boom") as keyof typeof paths;
    return paths[tag] || paths["vine-boom"];
  }
  const automaticType: Partial<Record<IntelligentEditEvent["kind"], keyof typeof paths>> = {
    transition: "soft-whoosh",
    cut: "soft-whoosh",
    "impact-text": "subtle-pop",
    "lower-third": "subtle-pop",
    zoom: "rising-swoosh",
  };
  const type = automaticType[event.kind];
  return type ? paths[type] : null;
}

async function collectSfxEvents(plan: IntelligentEditPlan) {
  if (plan.media.sfxEnabled === false) return [];
  const motion = resolveMotionProfile(plan.motion?.pace, plan.style);
  const sfxPaths = await ensureSfxLibrary();
  const events: Array<{ time: number; file: string; gainDb: number }> = [
    { time: 0.1, file: sfxPaths["soft-whoosh"], gainDb: -3 },
    { time: Math.max(0.1, editedVideoDuration(plan.events, plan.media.durationSeconds) + 4.1), file: sfxPaths["rising-swoosh"], gainDb: -3 },
  ];
  const hasSemanticSfx = plan.events.some((event) => event.kind === "sound-effect" && event.soundEffect);
  const visualEvents = plan.events.filter((event) =>
    ["transition", "cut", "impact-text", "lower-third", "zoom"].includes(event.kind),
  );
  for (const event of plan.events) {
    if (event.kind === "remove" || videoCutRanges(plan.events, plan.media.durationSeconds).some(
      (range) => event.start >= range.start && event.start < range.end,
    )) continue;
    if (hasSemanticSfx && event.kind !== "sound-effect" && event.kind !== "meme-sfx") continue;
    const file = sfxFileForEvent(event, sfxPaths);
    const nearestVisual = event.kind === "sound-effect"
      ? visualEvents
          .filter((candidate) => Math.abs(candidate.start - event.start) <= 0.8)
          .sort((left, right) => Math.abs(left.start - event.start) - Math.abs(right.start - event.start))[0]
      : event;
    const visualPeak = nearestVisual
      ? nearestVisual.start + Math.min(motion.entranceSeconds, nearestVisual.duration * 0.28) * 0.82
      : event.start;
    if (file) events.push({
      time: editedVideoTime(plan.events, plan.media.durationSeconds, visualPeak) + 4,
      file,
      gainDb: Math.max(-9, Math.min(3, event.soundEffectGainDb ?? 0)),
    });
  }
  return events.slice(0, 14);
}

async function finalizeVideoFromSegments(
  plan: IntelligentEditPlan,
  segmentPaths: string[],
  concatPath: string,
  outputPath: string,
  signal?: AbortSignal,
) {
  await writeConcatFile(segmentPaths, concatPath);
  const sfxEvents = await collectSfxEvents(plan);
  const voiceEnhanceEnabled = plan.media.voiceEnhance === true;
  const musicEnabled = Boolean(plan.media.musicPath);

  if (!musicEnabled && sfxEvents.length === 0 && !voiceEnhanceEnabled) {
    await runFfmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c", "copy", "-movflags", "+faststart", outputPath,
    ], 60 * 60_000, undefined, signal);
    return;
  }

  const args = ["-y", "-f", "concat", "-safe", "0", "-i", concatPath];
  const totalDuration = editedVideoDuration(plan.events, plan.media.durationSeconds) + 8;
  const filterParts: string[] = [];
  let voiceLabel = "[0:a]";

  if (voiceEnhanceEnabled) {
    filterParts.push(
      "[0:a]highpass=f=80,agate=threshold=-34dB:ratio=2:attack=10:release=120,acompressor=threshold=-18dB:ratio=3:attack=15:release=150[voice_clean]",
    );
    voiceLabel = "[voice_clean]";
  }

  const mixLabels = [voiceLabel];
  let nextInputIndex = 1;

  if (musicEnabled && plan.media.musicPath) {
    args.push("-stream_loop", "-1", "-i", plan.media.musicPath);
    const musicRawLabel = plan.media.autoDucking !== false ? "[music_raw]" : "[music]";
    filterParts.push(
      `[${nextInputIndex}:a]volume=${plan.media.musicDb}dB,atrim=0:${totalDuration.toFixed(3)},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, totalDuration - 1.5).toFixed(3)}:d=1.5${musicRawLabel}`,
    );

    if (plan.media.autoDucking !== false) {
      filterParts.push(
        `[music_raw]${voiceLabel}sidechaincompress=threshold=0.06:ratio=4:attack=40:release=350[music]`,
      );
    }
    mixLabels.push("[music]");
    nextInputIndex += 1;
  }

  const sfxVolume = plan.media.sfxVolumeDb ?? -12;
  sfxEvents.forEach((event, index) => {
    args.push("-i", event.file);
    const label = `[sfx${index}]`;
    filterParts.push(
      `[${nextInputIndex}:a]adelay=${Math.round(event.time * 1000)}|${Math.round(event.time * 1000)},volume=${(sfxVolume + event.gainDb).toFixed(1)}dB${label}`,
    );
    mixLabels.push(label);
    nextInputIndex += 1;
  });

  if (mixLabels.length > 1) {
    filterParts.push(
      `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2,alimiter=limit=0.95[aout]`,
    );
  } else {
    filterParts.push(`${voiceLabel}alimiter=limit=0.95[aout]`);
  }

  args.push(
    "-filter_complex", filterParts.join(";"),
    "-map", "0:v:0", "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "48000",
    "-movflags", "+faststart",
    outputPath,
  );
  await runFfmpeg(args, 60 * 60_000, undefined, signal);
}

function bodyChunkRanges(durationSeconds: number) {
  const chunkCount = Math.max(1, Math.ceil(durationSeconds / 30));
  const chunkDuration = durationSeconds / chunkCount;
  return Array.from({ length: chunkCount }, (_, index) => ({
    start: index * chunkDuration,
    duration: index === chunkCount - 1 ? durationSeconds - index * chunkDuration : chunkDuration,
  }));
}

async function renderCachedBodyChunks(
  plan: IntelligentEditPlan,
  profile: Pick<ResolvedVideoExportProfile, "width" | "height" | "fps">,
  cacheRoot: string,
  temporaryDirectory: string,
  encoder: VideoEncoder,
  encoderOptions: VideoEncoderOptions,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
) {
  const ranges = bodyChunkRanges(plan.media.durationSeconds);
  const cacheDirectory = path.join(cacheRoot, plan.id, "chunks-v1");
  await mkdir(cacheDirectory, { recursive: true });
  const source = await stat(plan.sourcePath);
  const paths: string[] = [];
  let cacheHits = 0;
  let fallbackUsed = false;
  for (const [index, range] of ranges.entries()) {
    if (signal?.aborted) throw new DOMException("Renderização cancelada.", "AbortError");
    const rangePlan = shiftedRangePlan(plan, range.start, range.duration, profile);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      rendererVersion: 1,
      sourceHash: plan.sourceHash,
      sourceSize: source.size,
      sourceModifiedAt: source.mtimeMs,
      start: range.start,
      duration: range.duration,
      events: rangePlan.events,
      captions: rangePlan.captions,
      design: rangePlan.design,
      identity: rangePlan.courseIdentity,
      motion: rangePlan.motion,
      profile,
      encoderOptions,
    })).digest("hex");
    const outputPath = path.join(cacheDirectory, `${fingerprint}.mp4`);
    const cached = await stat(outputPath).catch(() => null);
    if (cached?.isFile() && cached.size > 0) {
      cacheHits += 1;
      paths.push(outputPath);
      onProgress?.((index + 1) / ranges.length);
      continue;
    }
    const assPath = path.join(temporaryDirectory, `chunk-${index}-${fingerprint.slice(0, 10)}.ass`);
    const partialPath = `${outputPath}.partial`;
    await unlink(partialPath).catch(() => undefined);
    await writeFile(assPath, bodyAss(rangePlan), "utf8");
    try {
      try {
        await renderBody(rangePlan, assPath, partialPath, encoder, (value) => {
          onProgress?.((index + value) / ranges.length);
        }, encoderOptions, signal, range.start, false);
      } catch (error) {
        if ((error as Error).name === "AbortError" || encoder !== "amd-amf") throw error;
        fallbackUsed = true;
        await unlink(partialPath).catch(() => undefined);
        await renderBody(rangePlan, assPath, partialPath, "libx264", (value) => {
          onProgress?.((index + value) / ranges.length);
        }, encoderOptions, signal, range.start, false);
      }
      await rename(partialPath, outputPath);
      paths.push(outputPath);
    } finally {
      await Promise.all([partialPath, assPath].map((filePath) => unlink(filePath).catch(() => undefined)));
    }
  }
  return { paths, cacheHits, fallbackUsed, chunkCount: ranges.length };
}

export async function renderIntelligentEdit(
  rawInput: Record<string, unknown>,
  execution: RenderExecutionOptions = {},
) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await readIntelligentEditPlan(planId || undefined);
  if (!plan) throw new Error("Plano inteligente não encontrado.");
  const renderStatus: IntelligentRenderStatus = {
    status: "running",
    planId: plan.id,
    progress: 1,
    stage: "Preparando renderização...",
    startedAt: new Date().toISOString(),
  };
  let lastProgress = 0;
  let statusWrite = Promise.resolve();
  const reportProgress = (progress: number, stage = "Renderizando video...") => {
    const nextProgress = Math.max(lastProgress, Math.min(99, Math.round(progress)));
    if (nextProgress === lastProgress && renderStatus.stage === stage) return;
    lastProgress = nextProgress;
    renderStatus.progress = nextProgress;
    renderStatus.stage = stage;
    execution.onProgress?.(nextProgress, stage);
    statusWrite = statusWrite
      .then(() => writeRenderStatus({ ...renderStatus }))
      .catch(() => undefined);
  };
  await writeRenderStatus(renderStatus);
  const outputResolution = normalizeVideoOutputResolution(rawInput.outputResolution);
  const renderMode = rawInput.renderMode === "live-preview" ? "live-preview" : "final";
  const requestedProfile = rawInput.exportProfile && typeof rawInput.exportProfile === "object"
    ? normalizeVideoExportProfile(rawInput.exportProfile)
    : null;
  const resolvedProfile = requestedProfile
    ? resolveVideoExportProfile(requestedProfile, plan.media)
    : null;
  const outputDimensions = resolvedProfile || resolveVideoOutputDimensions(
      plan.media.width,
      plan.media.height,
      outputResolution,
    );
  const renderPlan: IntelligentEditPlan = {
    ...plan,
    media: {
      ...plan.media,
      width: outputDimensions.width,
      height: outputDimensions.height,
      fps: resolvedProfile?.fps || plan.media.fps,
    },
    design: plan.design ? {
      ...plan.design,
      captionsEnabled: renderMode === "final" && plan.design.captionsEnabled !== false,
    } : plan.design,
  };
  const requestedEncoder = normalizeVideoEncoderPreference(resolvedProfile?.videoEncoder ?? rawInput.videoEncoder);
  let encoder = await selectVideoEncoder(requestedEncoder);
  let encoderFallback = false;
  const encoderOptions: VideoEncoderOptions = {
    bitrateKbps: resolvedProfile?.bitrateKbps,
    speed: renderMode === "live-preview" ? "speed" : "balanced",
  };
  const prefix = renderMode === "live-preview" ? "live-preview" : "final";
  const requestedWorkingDirectory = typeof rawInput.workingDirectory === "string" && path.isAbsolute(rawInput.workingDirectory)
    ? path.resolve(rawInput.workingDirectory)
    : plan.artifacts.directory;
  const directory = path.join(requestedWorkingDirectory, plan.id, prefix);
  await mkdir(directory, { recursive: true });
  const introAssPath = path.join(directory, `${prefix}-intro.ass`);
  const outroAssPath = path.join(directory, `${prefix}-outro.ass`);
  const introPath = path.join(directory, `${prefix}-intro.mp4`);
  const outroPath = path.join(directory, `${prefix}-outro.mp4`);
  const concatPath = path.join(directory, `${prefix}-concat.txt`);
  const requestedOutputPath = typeof rawInput.outputPath === "string" && path.isAbsolute(rawInput.outputPath)
    ? path.resolve(rawInput.outputPath)
    : undefined;
  const previewPath = requestedOutputPath || path.join(
    plan.artifacts.directory,
    renderMode === "live-preview" ? "live-preview-v1.mp4" : "preview-v4.mp4",
  );
  const partialPath = previewPath.replace(/\.mp4$/i, ".partial.mp4");
  const temporaryPaths = [introPath, outroPath, concatPath, partialPath, introAssPath, outroAssPath];
  await Promise.all(temporaryPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
  await writeFile(introAssPath, titleAss(renderPlan, "intro"), "utf8");
  await writeFile(outroAssPath, titleAss(renderPlan, "outro"), "utf8");
  const outputProfile = {
    width: outputDimensions.width,
    height: outputDimensions.height,
    fps: resolvedProfile?.fps || plan.media.fps,
  };
  let cacheHits = 0;
  let chunkCount = 0;
  try {
    reportProgress(3, "Renderizando abertura...");
    try {
      await renderCard(renderPlan, "intro", introAssPath, introPath, encoder, (value) => reportProgress(3 + value * 5, "Renderizando abertura..."), encoderOptions, execution.signal);
    } catch (error) {
      if ((error as Error).name === "AbortError" || encoder !== "amd-amf") throw error;
      encoderFallback = true;
      await unlink(introPath).catch(() => undefined);
      await renderCard(renderPlan, "intro", introAssPath, introPath, "libx264", (value) => reportProgress(3 + value * 5, "Renderizando abertura com CPU..."), encoderOptions, execution.signal);
    }
    const body = await renderCachedBodyChunks(
      renderPlan,
      outputProfile,
      requestedWorkingDirectory,
      directory,
      encoder,
      encoderOptions,
      (progress) => reportProgress(8 + progress * 76, cacheHits > 0 ? "Reutilizando e renderizando chunks..." : "Renderizando chunks de até 30 segundos..."),
      execution.signal,
    );
    cacheHits = body.cacheHits;
    chunkCount = body.chunkCount;
    encoderFallback ||= body.fallbackUsed;
    reportProgress(84, "Renderizando encerramento...");
    try {
      await renderCard(renderPlan, "outro", outroAssPath, outroPath, encoder, (value) => reportProgress(84 + value * 4, "Renderizando encerramento..."), encoderOptions, execution.signal);
    } catch (error) {
      if ((error as Error).name === "AbortError" || encoder !== "amd-amf") throw error;
      encoderFallback = true;
      await unlink(outroPath).catch(() => undefined);
      await renderCard(renderPlan, "outro", outroAssPath, outroPath, "libx264", (value) => reportProgress(84 + value * 4, "Renderizando encerramento com CPU..."), encoderOptions, execution.signal);
    }
    reportProgress(88, "Unindo chunks e finalizando áudio...");
    await finalizeVideoFromSegments(renderPlan, [introPath, ...body.paths, outroPath], concatPath, partialPath, execution.signal);
    await unlink(previewPath).catch(() => undefined);
    await rename(partialPath, previewPath);
  } finally {
    await unlink(partialPath).catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    planId: plan.id,
    updatedAt: plan.editorial?.updatedAt,
    renderMode,
    profile: resolvedProfile,
  })).digest("hex");
  const updated: IntelligentEditPlan = {
    ...plan,
    artifacts: renderMode === "live-preview"
      ? { ...plan.artifacts, previewPath, proxyPath: previewPath, proxyFingerprint: fingerprint }
      : { ...plan.artifacts, finalPath: previewPath, finalFingerprint: fingerprint },
  };
  if (renderMode === "live-preview") await recordEditorialPreview(plan, previewPath);
  await statusWrite;
  renderStatus.status = "completed";
  renderStatus.progress = 100;
  renderStatus.stage = "Vídeo renderizado.";
  renderStatus.completedAt = new Date().toISOString();
  await writeRenderStatus(renderStatus);
  return {
    planId: plan.id,
    plan: updated,
    previewPath,
    finalPath: renderMode === "final" ? previewPath : undefined,
    renderMode,
    outputResolution: {
      mode: resolvedProfile?.resolution || outputResolution,
      ...outputDimensions,
    },
    exportProfile: resolvedProfile,
    videoEncoder: {
      requested: requestedEncoder,
      used: encoder,
      fallback: encoderFallback,
    },
    cacheHits,
    chunkCount,
    durationSeconds: editedVideoDuration(plan.events, plan.media.durationSeconds) + 8,
    effectsApplied: {
      intro: true,
      outro: true,
      lowerThirds: plan.events.filter((item) => item.kind === "lower-third").length,
      impactTexts: plan.events.filter((item) => item.kind === "impact-text").length,
      zooms: plan.events.filter((item) => item.kind === "zoom").length,
      cuts: plan.events.filter((item) => item.kind === "cut" || item.kind === "remove").length,
      cursorHighlights: plan.events.filter((item) => item.kind === "cursor").length,
      transitions: plan.events.filter((item) => item.kind === "transition").length + 2,
      captions: renderMode === "final" && resolveIntelligentEditDesign(plan).captionsEnabled ? plan.captions.length : 0,
      liveCaptionOverlay: renderMode === "live-preview" && resolveIntelligentEditDesign(plan).captionsEnabled,
      palette: resolveIntelligentEditDesign(plan).palette,
      courseTheme: plan.courseTheme?.label,
      courseThemeReused: plan.courseTheme?.reused,
      colorCorrection: true,
      voiceProcessing: true,
      backgroundMusic: Boolean(plan.media.musicPath),
      visualAnalysis: plan.visual.source,
    },
  };
}

function shiftedRangePlan(
  plan: IntelligentEditPlan,
  start: number,
  duration: number,
  profile: Pick<ResolvedVideoExportProfile, "width" | "height" | "fps">,
) {
  const end = start + duration;
  const overlaps = (itemStart: number, itemDuration: number) => itemStart < end && itemStart + itemDuration > start;
  return {
    ...plan,
    media: {
      ...plan.media,
      width: profile.width,
      height: profile.height,
      fps: profile.fps,
      durationSeconds: duration,
    },
    events: plan.events
      .filter((event) => event.kind !== "intro" && event.kind !== "outro" && overlaps(event.start, event.duration))
      .map((event) => ({
        ...event,
        start: Math.max(0, event.start - start),
        duration: Math.max(0.01, Math.min(end, event.start + event.duration) - Math.max(start, event.start)),
      })),
    captions: plan.captions
      .filter((caption) => caption.start < end && caption.end > start)
      .map((caption) => ({
        ...caption,
        start: Math.max(0, caption.start - start),
        end: Math.min(duration, caption.end - start),
        words: caption.words?.filter((word) => word.start < end && word.end > start).map((word) => ({
          ...word,
          start: Math.max(0, word.start - start),
          end: Math.min(duration, word.end - start),
        })),
      })),
    design: plan.design ? { ...plan.design, captionsEnabled: plan.design.captionsEnabled !== false } : plan.design,
  } satisfies IntelligentEditPlan;
}

export async function renderIntelligentProxy(
  rawInput: Record<string, unknown>,
  execution: RenderExecutionOptions = {},
) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await readIntelligentEditPlan(planId || undefined);
  if (!plan) throw new Error("Plano inteligente não encontrado.");
  const profile = proxyVideoProfile(plan.media);
  const source = await stat(plan.sourcePath);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    sourceHash: plan.sourceHash,
    sourceSize: source.size,
    sourceModifiedAt: source.mtimeMs,
    profile,
    version: 1,
  })).digest("hex");
  const cacheDirectory = typeof rawInput.cacheDirectory === "string" && path.isAbsolute(rawInput.cacheDirectory)
    ? path.resolve(rawInput.cacheDirectory)
    : plan.artifacts.directory;
  const proxyDirectory = path.join(cacheDirectory, plan.id, "proxy");
  await mkdir(proxyDirectory, { recursive: true });
  const proxyPath = path.join(proxyDirectory, `proxy-v1-${fingerprint.slice(0, 12)}.mp4`);
  const cached = await stat(proxyPath).catch(() => null);
  if (cached?.isFile() && cached.size > 0) {
    await recordEditorialPreview(plan, proxyPath);
    return {
      planId: plan.id,
      proxyPath,
      previewPath: proxyPath,
      fingerprint,
      cached: true,
      exportProfile: profile,
      durationSeconds: plan.media.durationSeconds,
    };
  }
  const partialPath = proxyPath.replace(/\.mp4$/i, ".partial.mp4");
  await unlink(partialPath).catch(() => undefined);
  let encoder = await selectVideoEncoder(profile.videoEncoder);
  let fallback = false;
  const args = (selected: VideoEncoder) => [
    "-y", "-i", plan.sourcePath,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `scale=${profile.width}:${profile.height}:flags=bilinear`,
    "-r", String(profile.fps),
    "-g", String(profile.fps),
    ...videoEncoderArguments(selected, { bitrateKbps: profile.bitrateKbps, speed: "speed" }),
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    "-movflags", "+faststart",
    partialPath,
  ];
  try {
    await runFfmpeg(args(encoder), 60 * 60_000, (seconds) => {
      execution.onProgress?.(Math.min(99, Math.round(seconds / plan.media.durationSeconds * 100)), "Gerando proxy 720p...");
    }, execution.signal);
  } catch (error) {
    if ((error as Error).name === "AbortError" || encoder !== "amd-amf") throw error;
    encoder = "libx264";
    fallback = true;
    await unlink(partialPath).catch(() => undefined);
    await runFfmpeg(args(encoder), 60 * 60_000, (seconds) => {
      execution.onProgress?.(Math.min(99, Math.round(seconds / plan.media.durationSeconds * 100)), "Gerando proxy com CPU...");
    }, execution.signal);
  }
  await rename(partialPath, proxyPath);
  await recordEditorialPreview(plan, proxyPath);
  execution.onProgress?.(100, "Proxy pronto.");
  return {
    planId: plan.id,
    proxyPath,
    previewPath: proxyPath,
    fingerprint,
    cached: false,
    videoEncoder: { used: encoder, fallback },
    exportProfile: profile,
    estimatedBytes: estimateVideoExportBytes(plan.media.durationSeconds, profile),
    durationSeconds: plan.media.durationSeconds,
  };
}

export async function renderIntelligentSpotPreview(
  rawInput: Record<string, unknown>,
  execution: RenderExecutionOptions = {},
) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await readIntelligentEditPlan(planId || undefined);
  if (!plan) throw new Error("Plano inteligente não encontrado.");
  const requestedDuration = Math.max(1, Math.min(30, Number(rawInput.durationSeconds) || 10));
  const start = Math.max(0, Math.min(
    plan.media.durationSeconds - requestedDuration,
    Number(rawInput.startSeconds) || 0,
  ));
  const duration = Math.min(requestedDuration, plan.media.durationSeconds - start);
  const profile = resolveVideoExportProfile(rawInput.exportProfile, plan.media);
  const rangePlan = shiftedRangePlan(plan, start, duration, profile);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    planId: plan.id,
    updatedAt: plan.editorial?.updatedAt,
    start,
    duration,
    profile,
  })).digest("hex");
  const cacheDirectory = typeof rawInput.cacheDirectory === "string" && path.isAbsolute(rawInput.cacheDirectory)
    ? path.resolve(rawInput.cacheDirectory)
    : plan.artifacts.directory;
  const spotDirectory = path.join(cacheDirectory, plan.id, "spot");
  await mkdir(spotDirectory, { recursive: true });
  const outputPath = path.join(spotDirectory, `spot-preview-v1-${fingerprint.slice(0, 12)}.mp4`);
  const cached = await stat(outputPath).catch(() => null);
  if (cached?.isFile() && cached.size > 0) return { planId: plan.id, spotPreviewPath: outputPath, fingerprint, cached: true, start, duration, exportProfile: profile };
  const assPath = path.join(spotDirectory, `spot-preview-${fingerprint.slice(0, 12)}.ass`);
  const partialPath = outputPath.replace(/\.mp4$/i, ".partial.mp4");
  await writeFile(assPath, bodyAss(rangePlan), "utf8");
  await unlink(partialPath).catch(() => undefined);
  let encoder = await selectVideoEncoder(profile.videoEncoder);
  let fallback = false;
  try {
    try {
      await renderBody(rangePlan, assPath, partialPath, encoder, (value) => {
        execution.onProgress?.(Math.round(value * 99), "Renderizando trecho exato...");
      }, { bitrateKbps: profile.bitrateKbps, speed: "speed" }, execution.signal, start, false);
    } catch (error) {
      if ((error as Error).name === "AbortError" || encoder !== "amd-amf") throw error;
      encoder = "libx264";
      fallback = true;
      await unlink(partialPath).catch(() => undefined);
      await renderBody(rangePlan, assPath, partialPath, encoder, (value) => {
        execution.onProgress?.(Math.round(value * 99), "Renderizando trecho com CPU...");
      }, { bitrateKbps: profile.bitrateKbps, speed: "speed" }, execution.signal, start, false);
    }
    await rename(partialPath, outputPath);
  } finally {
    await Promise.all([partialPath, assPath].map((filePath) => unlink(filePath).catch(() => undefined)));
  }
  execution.onProgress?.(100, "Trecho exato pronto.");
  return {
    planId: plan.id,
    spotPreviewPath: outputPath,
    fingerprint,
    cached: false,
    start,
    duration,
    videoEncoder: { used: encoder, fallback },
    exportProfile: profile,
  };
}

export async function approveIntelligentEdit(
  rawInput: Record<string, unknown>,
) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await readIntelligentEditPlan(planId || undefined);
  if (!plan) throw new Error("Plano inteligente não encontrado.");
  const completedFinalPath = typeof rawInput.finalPath === "string" && path.isAbsolute(rawInput.finalPath)
    ? path.resolve(rawInput.finalPath)
    : undefined;
  const finalPath = completedFinalPath || plan.artifacts.finalPath;
  if (!finalPath) throw new Error("Exporte o vídeo antes de enviá-lo ao Resolve.");
  await readFile(finalPath);
  return createDavinciFreePlan({
    requestId:
      typeof rawInput.requestId === "string"
        ? rawInput.requestId
        : `intelligent-${crypto.randomUUID()}`,
    timelineName: `${plan.moduleName} - edição inteligente`,
    mainPath: finalPath,
    fps: plan.media.fps,
    colorCorrection: false,
    markers: [
      {
        seconds: 0,
        kind: "review",
        name: "EDIÇÃO INTELIGENTE FINALIZADA",
        note: `Plano ${plan.id}; efeitos e legendas atuais incorporados no vídeo.`,
        durationSeconds: 1,
      },
    ],
  });
}
