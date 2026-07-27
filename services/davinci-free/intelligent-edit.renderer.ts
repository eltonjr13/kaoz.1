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
import { readIntelligentEditPlan } from "./intelligent-edit.service";

function ffmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH?.trim(),
    ffmpegStaticPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) || "ffmpeg";
}

function runFfmpeg(args: string[], timeoutMs = 15 * 60_000) {
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

function assHeader(width: number, height: number) {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,Segoe UI,54,&H00FFFFFF,&H000000FF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,3,1,2,90,90,62,1",
    "Style: LowerThird,Segoe UI Semibold,48,&H00FFFFFF,&H000000FF,&H00101010,&HC0101010,-1,0,0,0,100,100,0,0,3,1,0,1,70,70,105,1",
    "Style: ImpactText,Segoe UI Semibold,62,&H003BE8FF,&H000000FF,&H00101010,&HC0101010,-1,0,0,0,100,100,0,0,3,2,0,8,80,80,95,1",
    "Style: CardTitle,Segoe UI Semibold,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,5,80,80,80,1",
    "Style: CardSubtitle,Segoe UI,34,&H00B8C7D9,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,5,80,80,80,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

function bodyAss(plan: IntelligentEditPlan) {
  const lines = [assHeader(plan.media.width, plan.media.height)];
  for (const caption of plan.captions) {
    lines.push(
      `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Caption,,0,0,0,,${assText(wrapCaption(caption.text))}`,
    );
  }
  for (const event of plan.events.filter((item) => item.kind === "lower-third")) {
    lines.push(
      `Dialogue: 1,${assTime(event.start)},${assTime(event.start + event.duration)},LowerThird,,0,0,0,,{\\fad(100,180)\\move(-650,${Math.round(plan.media.height * 0.86)},70,${Math.round(plan.media.height * 0.86)},0,260)}${assText(event.label)}`,
    );
  }
  let previousImpactEnd = Number.NEGATIVE_INFINITY;
  for (const [index, event] of plan.events
    .filter((item) => item.kind === "impact-text")
    .entries()) {
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
    const impactStart = Math.min(
      plan.media.durationSeconds - event.duration,
      Math.max(desiredStart, previousImpactEnd + 0.25),
    );
    previousImpactEnd = impactStart + event.duration;
    const impactX = Math.round(plan.media.width * (index % 2 === 0 ? 0.24 : 0.76));
    lines.push(
      `Dialogue: 2,${assTime(impactStart)},${assTime(impactStart + event.duration)},ImpactText,,0,0,0,,{\\an8\\pos(${impactX},${Math.round(plan.media.height * 0.12)})\\fad(100,180)\\fscx68\\fscy68\\t(0,230,\\fscx100\\fscy100)}${assText(event.label)}`,
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
  const title = kind === "intro" ? plan.moduleName : event?.label || "Próxima aula";
  const subtitle =
    kind === "intro"
      ? plan.courseName || "Curso"
      : plan.courseName || plan.moduleName;
  return [
    assHeader(plan.media.width, plan.media.height),
    `Dialogue: 0,${assTime(0.45)},${assTime(duration - 0.35)},CardTitle,,0,0,25,,${assText(title)}`,
    `Dialogue: 0,${assTime(1.1)},${assTime(duration - 0.35)},CardSubtitle,,0,0,-75,,${assText(subtitle)}`,
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
    const coordinate = Math.max(0, Math.min(1, event[axis]!)).toFixed(4);
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
  const scale = scaleExpression(plan.events);
  const focusX = focalExpression(plan.events, "x");
  const focusY = focalExpression(plan.events, "y");
  const transition = transitionExpression(plan.events);
  const filters = [
    `scale=w='trunc(iw*(${scale})/2)*2':h='trunc(ih*(${scale})/2)*2':eval=frame`,
    `crop=${plan.media.width}:${plan.media.height}:x='${focusX}':y='${focusY}'`,
    `eq=contrast=1.025:saturation=1.05:gamma=1.0:brightness='-0.95*(${transition})':eval=frame`,
    `ass='${filterPath(assPath)}'`,
    "fade=t=in:st=0:d=0.25",
    `fade=t=out:st=${Math.max(0, plan.media.durationSeconds - 0.35).toFixed(3)}:d=0.35`,
  ];
  for (const event of plan.events.filter(
    (item) => item.kind === "cursor" && item.x !== undefined && item.y !== undefined,
  )) {
    const size = Math.max(36, Math.round(Math.min(plan.media.width, plan.media.height) * 0.055));
    filters.push(
      `drawbox=x=${Math.round(event.x! - size / 2)}:y=${Math.round(event.y! - size / 2)}:w=${size}:h=${size}:color=yellow@0.75:t=4:enable='between(t,${event.start.toFixed(3)},${(event.start + event.duration).toFixed(3)})'`,
    );
  }
  return filters.join(",");
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
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x10141c:s=${plan.media.width}x${plan.media.height}:r=${plan.media.fps.toFixed(3)}:d=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}`,
    "-vf",
    `ass='${filterPath(assPath)}',fade=t=in:st=0:d=0.35,fade=t=out:st=${(duration - 0.35).toFixed(3)}:d=0.35`,
    "-af",
    `afade=t=in:st=0:d=0.35,afade=t=out:st=${(duration - 0.35).toFixed(3)}:d=0.35`,
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
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
    "veryfast",
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
  const args = ["-y", "-i", introPath, "-i", bodyPath, "-i", outroPath];
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
    "veryfast",
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
  const previewPath = path.join(directory, "preview-v2.mp4");
  await writeFile(bodyAssPath, bodyAss(plan), "utf8");
  await writeFile(introAssPath, titleAss(plan, "intro"), "utf8");
  await writeFile(outroAssPath, titleAss(plan, "outro"), "utf8");
  await renderCard(plan, "intro", introAssPath, introPath);
  await renderBody(plan, bodyAssPath, bodyPath);
  await renderCard(plan, "outro", outroAssPath, outroPath);
  await concatenate(plan, introPath, bodyPath, outroPath, previewPath);
  const updated: IntelligentEditPlan = {
    ...plan,
    artifacts: { ...plan.artifacts, previewPath },
  };
  await writeFile(plan.artifacts.planPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
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
      captions: plan.captions.length,
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
