import crypto from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

import { createDavinciFreePlan } from "./davinci-free.service";
import {
  type IntelligentEditEvent,
  type IntelligentEditPlan,
} from "./intelligent-edit.types";
import { resolveIntelligentEditDesign } from "./intelligent-edit.design";
import { readIntelligentEditPlan } from "./intelligent-edit.service";
import { recordEditorialPreview } from "./intelligent-edit.review";
import { ensureSfxLibrary } from "./sfx.service";

function ffmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH?.trim(),
    ffmpegStaticPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) || "ffmpeg";
}

function runFfmpeg(args: string[], timeoutMs = 60 * 60_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Render excedeu o limite de tempo."));
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
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
    `Style: LowerThird,Segoe UI Semibold,40,${assColor(colors.text)},&H000000FF,${assColor(colors.background, "20")},${assColor(colors.surface, "35")},-1,0,0,0,100,100,0,0,1,2,1,1,70,70,105,1`,
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

function bodyAss(plan: IntelligentEditPlan) {
  const design = resolveIntelligentEditDesign(plan);
  const lines = [assHeader(plan)];
  if (design.captionsEnabled) {
    for (const caption of plan.captions) {
      lines.push(
        `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Caption,,0,0,0,,${assText(wrapCaption(caption.text))}`,
      );
    }
  }
  for (const event of plan.events.filter((item) => item.kind === "lower-third")) {
    lines.push(
      `Dialogue: 1,${assTime(event.start)},${assTime(event.start + event.duration)},LowerThird,,0,0,0,,{\\fad(100,180)\\move(-650,${Math.round(plan.media.height * 0.86)},70,${Math.round(plan.media.height * 0.86)},0,260)\\1c${assColor(design.colors.primary)}&}▌{\\1c${assColor(design.colors.text)}&} ${assText(event.label)}`,
    );
  }
  for (const layout of impactLayouts(plan)) {
    const centerY = layout.y + Math.round(layout.height / 2);
    lines.push(
      `Dialogue: 2,${assTime(layout.start)},${assTime(layout.end)},ImpactIcon,,0,0,0,,{\\pos(${layout.x + 44},${centerY})\\fad(80,170)\\1c${assColor(layout.accent)}&}${assText(layout.icon)}`,
    );
    lines.push(
      `Dialogue: 2,${assTime(layout.start)},${assTime(layout.end)},ImpactMeta,,0,0,0,,{\\an4\\move(${layout.x + 88},${layout.y + 27},${layout.x + 98},${layout.y + 27},0,220)\\fad(70,160)\\1c${assColor(layout.accent)}&}${assText(layout.meta)}`,
    );
    lines.push(
      `Dialogue: 2,${assTime(layout.start)},${assTime(layout.end)},ImpactText,,0,0,0,,{\\an4\\move(${layout.x + 88},${centerY + 13},${layout.x + 98},${centerY + 13},0,240)\\fad(90,180)\\fs${layout.fontSize}}${assText(layout.label)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function titleAss(
  plan: IntelligentEditPlan,
  kind: "intro" | "outro",
) {
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
  const index = kind === "intro" && identity
    ? `AULA ${String(identity.lessonIndex).padStart(2, "0")}  /  ${String(identity.lessonTotal).padStart(2, "0")}`
    : kind === "outro"
      ? "ENCERRAMENTO"
      : "NESTA AULA";
  const number = identity
    ? String(
        kind === "intro"
          ? identity.lessonIndex
          : Math.min(identity.lessonIndex + 1, identity.lessonTotal),
      ).padStart(2, "0")
    : "01";
  return [
    assHeader(plan),
    `Dialogue: 0,${assTime(0.2)},${assTime(duration - 0.3)},CardKicker,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.22)})\\fad(100,180)}${assText(kicker.toUpperCase())}`,
    `Dialogue: 0,${assTime(0.38)},${assTime(duration - 0.3)},CardTitle,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.43)})\\fad(120,180)\\fscx90\\fscy90\\t(0,320,\\fscx100\\fscy100)}${assText(wrapCardTitle(title))}`,
    `Dialogue: 0,${assTime(0.78)},${assTime(duration - 0.3)},CardSubtitle,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.63)})\\fad(140,180)}${assText(subtitle)}`,
    `Dialogue: 0,${assTime(0.95)},${assTime(duration - 0.3)},CardIndex,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.11)},${Math.round(plan.media.height * 0.78)})\\fad(150,180)}${assText(index)}`,
    `Dialogue: 0,${assTime(0.3)},${assTime(duration - 0.3)},CardNumber,,0,0,0,,{\\pos(${Math.round(plan.media.width * 0.85)},${Math.round(plan.media.height * 0.47)})\\fad(160,180)}${assText(number)}`,
    "",
  ].join("\n");
}

function filterPath(filePath: string) {
  return filePath.replaceAll("\\", "/").replace(":", "\\:");
}

function scaleExpression(events: IntelligentEditEvent[]) {
  const zoomExpressions = events
    .filter((event) => event.kind === "zoom")
    .map((event) => {
      const peak = Math.max(1.04, Math.min(1.16, event.scale || 1.12));
      const delta = peak - 1;
      const start = event.start.toFixed(3);
      const rampEnd = (event.start + 0.34).toFixed(3);
      const holdEnd = (event.start + Math.max(0.75, event.duration - 0.34)).toFixed(3);
      const end = (event.start + event.duration).toFixed(3);
      return `if(between(t,${start},${rampEnd}),1+${delta.toFixed(4)}*(t-${start})/0.34,if(between(t,${rampEnd},${holdEnd}),${peak.toFixed(4)},if(between(t,${holdEnd},${end}),${peak.toFixed(4)}-${delta.toFixed(4)}*(t-${holdEnd})/0.34,1)))`;
    });
  const cutExpressions = events
    .filter((event) => event.kind === "cut")
    .map((event) =>
      `if(between(t,${event.start.toFixed(3)},${(event.start + event.duration).toFixed(3)}),${Math.max(1, Math.min(1.14, event.scale || 1.055)).toFixed(4)},1)`,
    );
  const expressions = [...zoomExpressions, ...cutExpressions];
  return expressions.length ? expressions.reduce((left, right) => `max(${left},${right})`) : "1";
}

function focalExpression(events: IntelligentEditEvent[], axis: "x" | "y") {
  const candidates = [
    ...events.filter((event) => event.kind === "zoom"),
    ...events.filter((event) => event.kind === "cut"),
  ].filter((event) => event[axis] !== undefined);
  const defaultValue = axis === "x" ? "(in_w-out_w)/2" : "(in_h-out_h)/2";
  const inputSize = axis === "x" ? "in_w" : "in_h";
  const outputSize = axis === "x" ? "out_w" : "out_h";
  let expression = defaultValue;
  for (const event of [...candidates].reverse()) {
    const isZoom = event.kind === "zoom";
    const coordinate = isZoom ? "0.5000" : Math.max(0, Math.min(1, event[axis]!)).toFixed(4);
    const focused = `${coordinate}*${inputSize}-${outputSize}/2`;
    expression = `if(between(t,${event.start.toFixed(3)},${(event.start + event.duration).toFixed(3)}),${focused},${expression})`;
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
      return `if(between(t,${start.toFixed(3)},${middle.toFixed(3)}),(t-${start.toFixed(3)})/${half.toFixed(3)},if(between(t,${middle.toFixed(3)},${end.toFixed(3)}),1-(t-${middle.toFixed(3)})/${half.toFixed(3)},0))`;
    });
  return expressions.length
    ? expressions.reduce((left, right) => `max(${left},${right})`)
    : "0";
}

function bodyVideoFilter(plan: IntelligentEditPlan, assPath: string) {
  const design = resolveIntelligentEditDesign(plan);
  const scale = scaleExpression(plan.events);
  const focusX = focalExpression(plan.events, "x");
  const focusY = focalExpression(plan.events, "y");
  const transition = transitionExpression(plan.events);
  const filters = [
    `scale=w='trunc(iw*(${scale})/2)*2':h='trunc(ih*(${scale})/2)*2':eval=frame`,
    `crop=${plan.media.width}:${plan.media.height}:x='${focusX}':y='${focusY}'`,
    `eq=contrast=1.025:saturation=1.05:gamma=1.0:brightness='-0.95*(${transition})':eval=frame`,
  ];
  for (const layout of impactLayouts(plan)) {
    const enable = `between(t,${layout.start.toFixed(3)},${layout.end.toFixed(3)})`;
    const edgeWidth = layout.event.variant === "quote" ? 7 : 5;
    filters.push(
      `drawbox=x=${layout.x + 10}:y=${layout.y + 10}:w=${layout.width}:h=${layout.height}:color=black@0.22:t=fill:enable='${enable}'`,
      `drawbox=x=${layout.x}:y=${layout.y}:w=${layout.width}:h=${layout.height}:color=0x${design.colors.surface.slice(1)}@0.92:t=fill:enable='${enable}'`,
      `drawbox=x=${layout.x}:y=${layout.y}:w=${edgeWidth}:h=${layout.height}:color=0x${layout.accent.slice(1)}:t=fill:enable='${enable}'`,
      `drawbox=x=${layout.x + 18}:y=${layout.y + Math.round((layout.height - 54) / 2)}:w=54:h=54:color=0x${design.colors.background.slice(1)}@0.84:t=fill:enable='${enable}'`,
      `drawbox=x=${layout.x + 92}:y=${layout.y + 45}:w=${Math.min(120, layout.width - 120)}:h=2:color=0x${layout.accent.slice(1)}@0.72:t=fill:enable='${enable}'`,
    );
  }
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
    "fade=t=in:st=0:d=0.25",
    `fade=t=out:st=${Math.max(0, plan.media.durationSeconds - 0.35).toFixed(3)}:d=0.35`,
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
) {
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
    "fade=t=in:st=0:d=0.35",
    `fade=t=out:st=${(duration - 0.35).toFixed(3)}:d=0.35`,
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
    `afade=t=in:st=0:d=0.35,afade=t=out:st=${(duration - 0.35).toFixed(3)}:d=0.35`,
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "superfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    outputPath,
  ]);
}

async function renderBody(
  plan: IntelligentEditPlan,
  assPath: string,
  outputPath: string,
) {
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
    bodyVideoFilter(plan, assPath),
    "-af",
    audioFilter(),
    "-r",
    plan.media.fps.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "superfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    outputPath,
  ]);
}

async function concatenate(
  plan: IntelligentEditPlan,
  introPath: string,
  bodyPath: string,
  outroPath: string,
  outputPath: string,
) {
  const args = ["-y", "-threads", "0", "-i", introPath, "-i", bodyPath, "-i", outroPath];
  const totalDuration = plan.media.durationSeconds + 8;
  if (plan.media.musicPath) {
    args.push("-stream_loop", "-1", "-i", plan.media.musicPath);
  }
  const concat = "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[vbase][voice]";
  const filter = plan.media.musicPath
    ? `${concat};[3:a]volume=${plan.media.musicDb}dB,atrim=0:${totalDuration.toFixed(3)},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, totalDuration - 1.5).toFixed(3)}:d=1.5[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`
    : concat;
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[vbase]",
    "-map",
    plan.media.musicPath ? "[aout]" : "[voice]",
    "-c:v",
    "libx264",
    "-preset",
    "superfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    outputPath,
  );
  await runFfmpeg(args);
}

export async function renderIntelligentEdit(
  rawInput: Record<string, unknown>,
) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await readIntelligentEditPlan(planId || undefined);
  if (!plan) throw new Error("Plano inteligente não encontrado.");
  const directory = plan.artifacts.directory;
  const bodyAssPath = path.join(directory, "body.ass");
  const introAssPath = path.join(directory, "intro.ass");
  const outroAssPath = path.join(directory, "outro.ass");
  const introPath = path.join(directory, "intro.mp4");
  const bodyPath = path.join(directory, "body-edited.mp4");
  const outroPath = path.join(directory, "outro.mp4");
  const previewPath = path.join(directory, "preview-v4.mp4");
  await writeFile(bodyAssPath, bodyAss(plan), "utf8");
  await writeFile(introAssPath, titleAss(plan, "intro"), "utf8");
  await writeFile(outroAssPath, titleAss(plan, "outro"), "utf8");
  await Promise.all([
    renderCard(plan, "intro", introAssPath, introPath),
    renderBody(plan, bodyAssPath, bodyPath),
    renderCard(plan, "outro", outroAssPath, outroPath),
  ]);
  await concatenate(plan, introPath, bodyPath, outroPath, previewPath);
  const updated: IntelligentEditPlan = {
    ...plan,
    artifacts: { ...plan.artifacts, previewPath },
  };
  await recordEditorialPreview(plan, previewPath);
  return {
    planId: plan.id,
    plan: updated,
    previewPath,
    durationSeconds: plan.media.durationSeconds + 8,
    effectsApplied: {
      intro: true,
      outro: true,
      lowerThirds: plan.events.filter((item) => item.kind === "lower-third").length,
      impactTexts: plan.events.filter((item) => item.kind === "impact-text").length,
      zooms: plan.events.filter((item) => item.kind === "zoom").length,
      cuts: plan.events.filter((item) => item.kind === "cut").length,
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
