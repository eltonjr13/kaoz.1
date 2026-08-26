import crypto from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { createDavinciFreePlan } from "./davinci-free.service";
import {
  type IntelligentCaption,
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
} from "./video-encoder";
import { formattedLessonNumber } from "./lesson-download";
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
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-progress", "pipe:2", "-nostats", ...args], { windowsHide: true });
    const stderr: Buffer[] = [];
    let progressOutput = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Render excedeu o limite de tempo."));
    }, timeoutMs);
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
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg falhou (${code}): ${Buffer.concat(stderr).toString("utf8").slice(-1_200)}`));
    });
  });
}

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
    `Style: CaptionKaraoke,Segoe UI Black,56,${assColor(colors.primary)},&H00FFFFFF,&H00000000,&H88000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,65,1`,
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

function formatPresetCaption(
  rawText: string,
  start: number,
  end: number,
  preset: IntelligentEditDesign["captionPreset"],
  colors: IntelligentEditDesign["colors"],
  useEmojis: boolean,
  timedWords?: IntelligentCaption["words"],
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

  if (preset === "karaoke") {
    const sourceWords = timedWords?.length
      ? timedWords.map((word) => ({ ...word, text: word.text.trim() })).filter((word) => word.text)
      : text.split(/\s+/).map((word, index, words) => ({
          text: word,
          start: start + ((end - start) * index) / words.length,
          end: start + ((end - start) * (index + 1)) / words.length,
        }));
    const initialDelay = Math.max(0, Math.round(((sourceWords[0]?.start || start) - start) * 100));
    const middle = Math.ceil(sourceWords.length / 2);
    const kTags = sourceWords.map((word, index) => {
      const nextStart = sourceWords[index + 1]?.start ?? Math.min(end, word.end);
      const durationCs = Math.max(4, Math.round((nextStart - word.start) * 100));
      const separator = index === middle ? "\\N" : index > 0 ? " " : "";
      return `${separator}{\\k${durationCs}}${assText(word.text)}`;
    }).join("");
    return {
      styleName: "CaptionKaraoke",
      formattedText: `${initialDelay ? `{\\k${initialDelay}}` : ""}${kTags}`,
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
      return `{\\1c${assColor(colors.secondary || "#FFE600")}\\fscx108\\fscy108&}${safeWord}{\\1c&H00FFFFFF&\\fscx100\\fscy100}`;
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
      const { styleName, formattedText } = formatPresetCaption(
        caption.text,
        caption.start,
        caption.end,
        preset,
        design.colors,
        useEmojis,
        caption.words,
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
    ...videoEncoderArguments(encoder),
    "-c:a",
    "aac",
    "-ar",
    "48000",
    outputPath,
  ], 60 * 60_000, (seconds) => onProgress?.(Math.min(1, seconds / duration)));
}

async function renderBody(
  plan: IntelligentEditPlan,
  assPath: string,
  outputPath: string,
  encoder: VideoEncoder,
  onProgress?: (progress: number) => void,
) {
  const select = videoCutSelectExpression(plan.events, plan.media.durationSeconds);
  const videoFilter = [
    bodyVideoFilter(plan, assPath),
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
    "-i",
    plan.sourcePath,
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
    ...videoEncoderArguments(encoder),
    "-c:a",
    "aac",
    "-ar",
    "48000",
    outputPath,
  ], 60 * 60_000, (seconds) => onProgress?.(Math.min(1, seconds / plan.media.durationSeconds)));
}

function concatFileEntry(filePath: string) {
  const escaped = filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");
  return `file '${escaped}'`;
}

async function concatenateVideoSegments(
  paths: string[],
  concatPath: string,
  joinedPath: string,
) {
  await writeFile(concatPath, `${paths.map(concatFileEntry).join("\n")}\n`, "utf8");
  await runFfmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c", "copy",
    joinedPath,
  ]);
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

async function mixFinalAudio(
  plan: IntelligentEditPlan,
  joinedPath: string,
  outputPath: string,
) {
  const sfxEvents = await collectSfxEvents(plan);
  const voiceEnhanceEnabled = plan.media.voiceEnhance === true;
  const musicEnabled = Boolean(plan.media.musicPath);

  if (!musicEnabled && sfxEvents.length === 0 && !voiceEnhanceEnabled) {
    await runFfmpeg([
      "-y", "-i", joinedPath,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c", "copy", "-movflags", "+faststart", outputPath,
    ]);
    return;
  }

  const args = ["-y", "-i", joinedPath];
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
  await runFfmpeg(args);
}

async function renderSegments(
  plan: IntelligentEditPlan,
  paths: { introAss: string; bodyAss: string; outroAss: string; intro: string; body: string; outro: string },
  encoder: VideoEncoder,
  onProgress?: (progress: number) => void,
) {
  const segmentProgress = { intro: 0, body: 0, outro: 0 };
  const report = (segment: keyof typeof segmentProgress, value: number) => {
    segmentProgress[segment] = value;
    onProgress?.(
      (segmentProgress.intro * 0.08) +
      (segmentProgress.body * 0.84) +
      (segmentProgress.outro * 0.08),
    );
  };
  const results = await Promise.allSettled([
    renderCard(plan, "intro", paths.introAss, paths.intro, encoder, (value) => report("intro", value)),
    renderBody(plan, paths.bodyAss, paths.body, encoder, (value) => report("body", value)),
    renderCard(plan, "outro", paths.outroAss, paths.outro, encoder, (value) => report("outro", value)),
  ]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}

export async function renderIntelligentEdit(
  rawInput: Record<string, unknown>,
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
    statusWrite = statusWrite
      .then(() => writeRenderStatus({ ...renderStatus }))
      .catch(() => undefined);
  };
  await writeRenderStatus(renderStatus);
  const outputResolution = normalizeVideoOutputResolution(rawInput.outputResolution);
  const outputDimensions = resolveVideoOutputDimensions(
    plan.media.width,
    plan.media.height,
    outputResolution,
  );
  const renderPlan: IntelligentEditPlan = {
    ...plan,
    media: { ...plan.media, ...outputDimensions },
  };
  const requestedEncoder = normalizeVideoEncoderPreference(rawInput.videoEncoder);
  let encoder = await selectVideoEncoder(requestedEncoder);
  let encoderFallback = false;
  const directory = plan.artifacts.directory;
  const bodyAssPath = path.join(directory, "body.ass");
  const introAssPath = path.join(directory, "intro.ass");
  const outroAssPath = path.join(directory, "outro.ass");
  const introPath = path.join(directory, "intro.mp4");
  const bodyPath = path.join(directory, "body-edited.mp4");
  const outroPath = path.join(directory, "outro.mp4");
  const concatPath = path.join(directory, "preview-concat.txt");
  const joinedPath = path.join(directory, "preview-joined.mp4");
  const previewPath = path.join(directory, "preview-v4.mp4");
  await writeFile(bodyAssPath, bodyAss(renderPlan), "utf8");
  await writeFile(introAssPath, titleAss(renderPlan, "intro"), "utf8");
  await writeFile(outroAssPath, titleAss(renderPlan, "outro"), "utf8");
  const segmentPaths = {
    introAss: introAssPath,
    bodyAss: bodyAssPath,
    outroAss: outroAssPath,
    intro: introPath,
    body: bodyPath,
    outro: outroPath,
  };
  try {
    reportProgress(4, "Gerando cenas e efeitos...");
    await renderSegments(renderPlan, segmentPaths, encoder, (progress) => {
      reportProgress(4 + progress * 82, "Renderizando cenas com FFmpeg...");
    });
  } catch (error) {
    if (encoder !== "amd-amf") throw error;
    encoder = "libx264";
    encoderFallback = true;
    reportProgress(4, "Aceleração AMD indisponível; continuando com CPU...");
    await renderSegments(renderPlan, segmentPaths, encoder, (progress) => {
      reportProgress(4 + progress * 82, "Renderizando cenas com FFmpeg...");
    });
  }
  reportProgress(88, "Unindo as cenas renderizadas...");
  await concatenateVideoSegments(
    [introPath, bodyPath, outroPath],
    concatPath,
    joinedPath,
  );
  reportProgress(94, "Finalizando áudio e preparando o arquivo...");
  await mixFinalAudio(renderPlan, joinedPath, previewPath);
  const updated: IntelligentEditPlan = {
    ...plan,
    artifacts: { ...plan.artifacts, previewPath },
  };
  await recordEditorialPreview(plan, previewPath);
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
    outputResolution: {
      mode: outputResolution,
      ...outputDimensions,
    },
    videoEncoder: {
      requested: requestedEncoder,
      used: encoder,
      fallback: encoderFallback,
    },
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
      captions: resolveIntelligentEditDesign(plan).captionsEnabled ? plan.captions.length : 0,
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

export async function approveIntelligentEdit(
  rawInput: Record<string, unknown>,
) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await readIntelligentEditPlan(planId || undefined);
  if (!plan?.artifacts.previewPath) {
    throw new Error("Renderize a prévia antes de enviá-la ao Resolve.");
  }
  await readFile(plan.artifacts.previewPath);
  return createDavinciFreePlan({
    requestId:
      typeof rawInput.requestId === "string"
        ? rawInput.requestId
        : `intelligent-${crypto.randomUUID()}`,
    timelineName: `${plan.moduleName} - edição inteligente`,
    mainPath: plan.artifacts.previewPath,
    fps: plan.media.fps,
    colorCorrection: false,
    markers: [
      {
        seconds: 0,
        kind: "review",
        name: "PRÉVIA INTELIGENTE RENDERIZADA",
        note: `Plano ${plan.id}; efeitos dinâmicos já incorporados no vídeo.`,
        durationSeconds: 1,
      },
    ],
  });
}
