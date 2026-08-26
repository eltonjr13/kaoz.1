import path from "node:path";
import { readFile } from "node:fs/promises";

import { getLocalDataDir } from "@/lib/runtime-paths";
import {
  INTELLIGENT_EDIT_PLAN_VERSION,
  type IntelligentCaption,
  type IntelligentEditorialReview,
  type IntelligentEditPlan,
} from "./intelligent-edit.types";
import {
  conservativelyReviewCaptions,
  loadIntelligentEditPlan,
  transcribeForCaptionResync,
  writeAnalysisStatus,
} from "./intelligent-edit.service";
import { captionsFromTranscript, remapCaptionOverrides } from "./caption-timing";
import { readEditorialReview } from "./intelligent-edit.review";
import { transactionalWrite, type PendingTransactionalWrite } from "./transactional-write";

type PendingWrite = PendingTransactionalWrite;

function formatSrtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function toSrt(captions: IntelligentCaption[]) {
  return captions.map((caption, index) =>
    `${index + 1}\n${formatSrtTime(caption.start)} --> ${formatSrtTime(caption.end)}\n${caption.text}\n`,
  ).join("\n");
}

function toPlainTranscript(plan: IntelligentEditPlan) {
  return plan.transcript.map((segment) =>
    `[${formatSrtTime(segment.start).slice(0, 8)}] ${segment.text.trim()}`,
  ).join("\n");
}

function inputId(value: unknown, pattern: RegExp, message: string) {
  const normalized = typeof value === "string" ? value : "";
  if (!pattern.test(normalized)) throw new Error(message);
  return normalized;
}

function nextPlanFor(
  plan: IntelligentEditPlan,
  transcript: IntelligentEditPlan["transcript"],
  transcription: IntelligentEditPlan["transcription"],
  captions: IntelligentCaption[],
  reviewed: boolean,
): IntelligentEditPlan {
  return {
    ...plan,
    version: INTELLIGENT_EDIT_PLAN_VERSION,
    transcript,
    transcription,
    captions,
    semantic: { ...plan.semantic, captionReview: reviewed ? "agent" : "asr-only" },
    artifacts: { ...plan.artifacts, previewPath: undefined },
  };
}

async function persistenceWrites(
  plan: IntelligentEditPlan,
  nextPlan: IntelligentEditPlan,
  nextReview: IntelligentEditorialReview,
) {
  const latestPath = path.join(getLocalDataDir(), "davinci-resolve-free", "intelligent", "latest-analysis.json");
  const latest = await readFile(latestPath, "utf8").then((value) => JSON.parse(value) as IntelligentEditPlan).catch(() => null);
  const transcriptTextPath = plan.artifacts.transcriptTextPath ?? path.join(plan.artifacts.directory, "transcript.txt");
  const writes: PendingWrite[] = [
    { target: plan.artifacts.transcriptPath, content: `${JSON.stringify(nextPlan.transcript, null, 2)}\n` },
    { target: transcriptTextPath, content: `${toPlainTranscript(nextPlan)}\n` },
    { target: plan.artifacts.captionsPath, content: toSrt(nextPlan.captions) },
    { target: plan.artifacts.planPath, content: `${JSON.stringify(nextPlan, null, 2)}\n` },
    { target: path.join(plan.artifacts.directory, "editorial-review.json"), content: `${JSON.stringify(nextReview, null, 2)}\n` },
  ];
  if (latest?.id === plan.id) writes.push({ target: latestPath, content: `${JSON.stringify(nextPlan, null, 2)}\n` });
  return writes;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function resyncIntelligentCaptions(rawInput: Record<string, unknown>) {
  const planId = inputId(rawInput.planId, /^[a-f0-9]{16}$/, "planId inválido para resincronização.");
  const requestId = inputId(rawInput.requestId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/, "requestId inválido para resincronização.");
  const plan = await loadIntelligentEditPlan(planId);
  if (!plan) throw new Error("Plano de edição não encontrado para resincronização.");
  const startedAt = new Date().toISOString();
  await writeAnalysisStatus({
    status: "running", requestId, sourcePath: plan.sourcePath, startedAt, progress: 5,
    stage: "Preparando a resincronização das legendas...",
  });
  try {
    const transcription = await transcribeForCaptionResync(plan, rawInput, (completed, total) => {
      void writeAnalysisStatus({
        status: "running", requestId, sourcePath: plan.sourcePath, startedAt,
        progress: 10 + Math.round((completed / Math.max(1, total)) * 65),
        stage: `Resincronizando falas: ${completed}/${total} trechos...`,
      });
    });
    const generated = captionsFromTranscript(transcription.segments, plan.media.durationSeconds, transcription.speechIntervals);
    const correction = await conservativelyReviewCaptions(generated, rawInput.useAgent !== false)
      .catch(() => ({ captions: generated, reviewed: false }));
    const oldReview = await readEditorialReview(plan);
    const remapped = remapCaptionOverrides(plan.captions, correction.captions, oldReview.captions);
    const nextPlan = nextPlanFor(
      plan,
      transcription.segments,
      transcription.transcription,
      correction.captions,
      correction.reviewed,
    );
    const nextReview: IntelligentEditorialReview = {
      ...oldReview,
      updatedAt: new Date().toISOString(),
      captions: remapped.overrides,
      previewPath: undefined,
    };
    const writes = await persistenceWrites(plan, nextPlan, nextReview);
    await writeAnalysisStatus({
      status: "running", requestId, sourcePath: plan.sourcePath, startedAt, progress: 92,
      stage: "Salvando legendas resincronizadas...",
    });
    await transactionalWrite(writes);
    await writeAnalysisStatus({
      status: "completed", requestId, sourcePath: plan.sourcePath, startedAt, progress: 100,
      stage: "Legendas resincronizadas.", completedAt: new Date().toISOString(), planId: plan.id,
    });
    return {
      ...nextPlan,
      timingPrecision: nextPlan.transcription?.timingPrecision ?? "approximate",
      remappedCaptionOverrides: remapped.overrides.length,
      unmatchedCaptionOverrides: remapped.unmatched,
      previewInvalidated: true,
    };
  } catch (error) {
    await writeAnalysisStatus({
      status: "failed", requestId, sourcePath: plan.sourcePath, startedAt,
      error: errorMessage(error),
    });
    throw error;
  }
}
