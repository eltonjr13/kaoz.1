import crypto from "node:crypto";
import path from "node:path";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { getLocalDataDir } from "@/lib/runtime-paths";
import {
  INTELLIGENT_EDIT_PLAN_VERSION,
  type IntelligentCaption,
  type IntelligentEditorialCaptionOverride,
  type IntelligentEditorialReview,
  type IntelligentEditPlan,
} from "./intelligent-edit.types";
import {
  conservativelyReviewCaptions,
  loadIntelligentEditPlan,
  transcribeForCaptionResync,
  writeAnalysisStatus,
} from "./intelligent-edit.service";
import { captionsFromTranscript } from "./caption-timing";
import { readEditorialReview } from "./intelligent-edit.review";

type PendingWrite = { target: string; content: string };

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

function normalizedTokens(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function textSimilarity(left: string, right: string) {
  const leftTokens = normalizedTokens(left);
  const rightTokens = normalizedTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const remaining = [...rightTokens];
  let matches = 0;
  for (const token of leftTokens) {
    const index = remaining.indexOf(token);
    if (index >= 0) {
      matches += 1;
      remaining.splice(index, 1);
    }
  }
  return (2 * matches) / (leftTokens.length + rightTokens.length);
}

function temporalIou(left: IntelligentCaption, right: IntelligentCaption) {
  const intersection = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
  const union = Math.max(left.end, right.end) - Math.min(left.start, right.start);
  return union > 0 ? intersection / union : 0;
}

export function remapCaptionOverrides(
  oldCaptions: IntelligentCaption[],
  newCaptions: IntelligentCaption[],
  overrides: IntelligentEditorialCaptionOverride[],
) {
  const used = new Set<number>();
  const mapped: IntelligentEditorialCaptionOverride[] = [];
  let unmatched = 0;
  for (const override of [...overrides].sort((left, right) => left.index - right.index)) {
    const original = oldCaptions[override.index];
    if (!original) {
      unmatched += 1;
      continue;
    }
    const source = { ...original, text: override.text || original.text };
    const candidate = newCaptions
      .map((caption, index) => ({
        index,
        score: textSimilarity(source.text, caption.text) * 0.65 + temporalIou(source, caption) * 0.35,
      }))
      .filter((item) => !used.has(item.index))
      .sort((left, right) => right.score - left.score)[0];
    if (!candidate || candidate.score < 0.6) {
      unmatched += 1;
      continue;
    }
    used.add(candidate.index);
    mapped.push({
      index: candidate.index,
      ...(typeof override.enabled === "boolean" ? { enabled: override.enabled } : {}),
      ...(override.text ? { text: override.text } : {}),
    });
  }
  return { overrides: mapped.sort((left, right) => left.index - right.index), unmatched };
}

async function transactionalWrite(entries: PendingWrite[]) {
  const id = crypto.randomUUID();
  const prepared = entries.map((entry) => ({
    ...entry,
    temporary: `${entry.target}.${id}.tmp`,
    backup: `${entry.target}.${id}.bak`,
  }));
  for (const entry of prepared) await writeFile(entry.temporary, entry.content, "utf8");
  const committed: typeof prepared = [];
  const backedUp: typeof prepared = [];
  try {
    for (const entry of prepared) {
      await rename(entry.target, entry.backup).then(() => backedUp.push(entry)).catch(() => undefined);
      await rename(entry.temporary, entry.target);
      committed.push(entry);
    }
    await Promise.all(prepared.map((entry) => rm(entry.backup, { force: true })));
  } catch (error) {
    for (const entry of committed.reverse()) {
      await rm(entry.target, { force: true }).catch(() => undefined);
    }
    for (const entry of backedUp.reverse()) {
      await rename(entry.backup, entry.target).catch(() => undefined);
    }
    throw error;
  } finally {
    await Promise.all(prepared.flatMap((entry) => [
      rm(entry.temporary, { force: true }),
      rm(entry.backup, { force: true }),
    ]));
  }
}

export async function resyncIntelligentCaptions(rawInput: Record<string, unknown>) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId : "";
  const requestId = typeof rawInput.requestId === "string" ? rawInput.requestId : "";
  if (!/^[a-f0-9]{16}$/.test(planId)) throw new Error("planId inválido para resincronização.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(requestId)) throw new Error("requestId inválido para resincronização.");
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
    const nextPlan: IntelligentEditPlan = {
      ...plan,
      version: INTELLIGENT_EDIT_PLAN_VERSION,
      transcript: transcription.segments,
      transcription: transcription.transcription,
      captions: correction.captions,
      semantic: {
        ...plan.semantic,
        captionReview: correction.reviewed ? "agent" : "asr-only",
      },
      artifacts: { ...plan.artifacts, previewPath: undefined },
    };
    const nextReview: IntelligentEditorialReview = {
      ...oldReview,
      updatedAt: new Date().toISOString(),
      captions: remapped.overrides,
      previewPath: undefined,
    };
    const latestPath = path.join(getLocalDataDir(), "davinci-resolve-free", "intelligent", "latest-analysis.json");
    const latest = await readFile(latestPath, "utf8").then((value) => JSON.parse(value) as IntelligentEditPlan).catch(() => null);
    const writes: PendingWrite[] = [
      { target: plan.artifacts.transcriptPath, content: `${JSON.stringify(nextPlan.transcript, null, 2)}\n` },
      { target: plan.artifacts.transcriptTextPath || path.join(plan.artifacts.directory, "transcript.txt"), content: `${toPlainTranscript(nextPlan)}\n` },
      { target: plan.artifacts.captionsPath, content: toSrt(nextPlan.captions) },
      { target: plan.artifacts.planPath, content: `${JSON.stringify(nextPlan, null, 2)}\n` },
      { target: path.join(plan.artifacts.directory, "editorial-review.json"), content: `${JSON.stringify(nextReview, null, 2)}\n` },
    ];
    if (latest?.id === plan.id) writes.push({ target: latestPath, content: `${JSON.stringify(nextPlan, null, 2)}\n` });
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
      timingPrecision: nextPlan.transcription?.timingPrecision || "approximate",
      remappedCaptionOverrides: remapped.overrides.length,
      unmatchedCaptionOverrides: remapped.unmatched,
      previewInvalidated: true,
    };
  } catch (error) {
    await writeAnalysisStatus({
      status: "failed", requestId, sourcePath: plan.sourcePath, startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
