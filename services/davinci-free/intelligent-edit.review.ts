import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { loadIntelligentEditPlan } from "./intelligent-edit.service";
import type {
  IntelligentCourseEditorialStandard,
  IntelligentEditorialCaptionOverride,
  IntelligentEditorialEventOverride,
  IntelligentEditorialReview,
  IntelligentEditEvent,
  IntelligentEditPlan,
} from "./intelligent-edit.types";

const STANDARD_ROOT = path.join(getLocalDataDir(), "davinci-resolve-free", "course-editorial-standards");

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : undefined;
}

function reviewPath(plan: IntelligentEditPlan) {
  return path.join(plan.artifacts.directory, "editorial-review.json");
}

function courseId(courseName: string) {
  return crypto.createHash("sha256")
    .update(courseName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function reviewFor(plan: IntelligentEditPlan, value: unknown): IntelligentEditorialReview {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const allowedEvents = new Map(plan.events.map((event) => [event.id, event]));
  const allowedKinds = new Set<IntelligentEditEvent["kind"]>([
    "lower-third",
    "impact-text",
    "zoom",
    "cut",
    "cursor",
    "transition",
  ]);
  const events = Array.isArray(raw.events) ? raw.events.flatMap((value): IntelligentEditorialEventOverride[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const original = allowedEvents.get(String(item.id));
    if (!original) return [];
    const start = Number(item.start);
    const duration = Number(item.duration);
    const scale = Number(item.scale);
    const x = Number(item.x);
    const y = Number(item.y);
    return [{
      id: original.id,
      ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
      ...(Number.isFinite(start) ? { start: clamp(start, 0, plan.media.durationSeconds) } : {}),
      ...(Number.isFinite(duration) ? { duration: clamp(duration, 0.1, 12) } : {}),
      ...(text(item.label, 120) ? { label: text(item.label, 120) } : {}),
      ...(text(item.subtitle, 160) ? { subtitle: text(item.subtitle, 160) } : {}),
      ...(Number.isFinite(scale) ? { scale: clamp(scale, 1, 1.14) } : {}),
      ...(Number.isFinite(x) ? { x: clamp(x, 0.28, 0.72) } : {}),
      ...(Number.isFinite(y) ? { y: clamp(y, 0.24, 0.62) } : {}),
    }];
  }) : [];
  const addedEvents = Array.isArray(raw.addedEvents)
    ? raw.addedEvents.flatMap((value): IntelligentEditEvent[] => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const id = String(item.id || "");
      const kind = String(item.kind || "") as IntelligentEditEvent["kind"];
      const start = Number(item.start);
      const duration = Number(item.duration);
      const label = text(item.label, 120);
      if (
        !/^custom-evt-[a-f0-9-]{8,36}$/.test(id)
        || !allowedKinds.has(kind)
        || !Number.isFinite(start)
        || !Number.isFinite(duration)
        || !label
      ) {
        return [];
      }
      return [{
        id,
        kind,
        start: clamp(start, 0, plan.media.durationSeconds),
        duration: clamp(duration, 0.1, 12),
        label,
        subtitle: text(item.subtitle, 160),
        reason: text(item.reason, 220) || "Evento adicionado manualmente na timeline.",
        ...(kind === "zoom" && Number.isFinite(Number(item.scale))
          ? { scale: clamp(Number(item.scale), 1, 1.14) }
          : {}),
        ...(kind === "zoom" && Number.isFinite(Number(item.x))
          ? { x: clamp(Number(item.x), 0.28, 0.72) }
          : {}),
        ...(kind === "zoom" && Number.isFinite(Number(item.y))
          ? { y: clamp(Number(item.y), 0.24, 0.62) }
          : {}),
      }];
    })
    : [];
  const captions = Array.isArray(raw.captions) ? raw.captions.flatMap((value): IntelligentEditorialCaptionOverride[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const index = Number(item.index);
    if (!Number.isInteger(index) || index < 0 || index >= plan.captions.length) return [];
    const start = Number(item.start);
    const end = Number(item.end);
    const nextStart = Number.isFinite(start) ? clamp(start, 0, plan.media.durationSeconds) : undefined;
    const nextEnd = Number.isFinite(end) ? clamp(end, (nextStart ?? plan.captions[index].start) + 0.1, plan.media.durationSeconds) : undefined;
    return [{
      index,
      ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
      ...(nextStart !== undefined ? { start: nextStart } : {}),
      ...(nextEnd !== undefined ? { end: nextEnd } : {}),
      ...(text(item.text, 220) ? { text: text(item.text, 220) } : {}),
    }];
  }) : [];
  return {
    version: 1,
    planId: plan.id,
    updatedAt: new Date().toISOString(),
    ...(typeof raw.captionsEnabled === "boolean" ? { captionsEnabled: raw.captionsEnabled } : {}),
    events,
    addedEvents,
    captions,
  };
}

export async function readEditorialReview(plan: IntelligentEditPlan) {
  return readFile(reviewPath(plan), "utf8")
    .then((raw) => reviewFor(plan, JSON.parse(raw)))
    .catch((): IntelligentEditorialReview => ({ version: 1, planId: plan.id, updatedAt: plan.createdAt, events: [], captions: [] }));
}

export function applyEditorialReview(plan: IntelligentEditPlan, review: IntelligentEditorialReview): IntelligentEditPlan {
  const events = new Map(review.events.map((event) => [event.id, event]));
  const captions = new Map(review.captions.map((caption) => [caption.index, caption]));
  const reviewedEvents = plan.events.flatMap((event) => {
    const change = events.get(event.id);
    if (change?.enabled === false) return [];
    return [{ ...event, ...change, id: event.id }];
  }).concat(review.addedEvents || []);
  const reviewedCaptions = plan.captions.flatMap((caption, index) => {
    const change = captions.get(index);
    if (change?.enabled === false) return [];
    return [{ ...caption, ...change }];
  });
  const captionsEnabled = review.captionsEnabled ?? (plan.design?.captionsEnabled !== false);
  return {
    ...plan,
    events: reviewedEvents,
    captions: reviewedCaptions,
    design: plan.design ? { ...plan.design, captionsEnabled } : plan.design,
    artifacts: review.previewPath ? { ...plan.artifacts, previewPath: review.previewPath } : plan.artifacts,
    editorial: {
      version: 1,
      updatedAt: review.updatedAt,
      modifiedEventIds: review.events.map((event) => event.id),
      modifiedCaptionIndexes: review.captions.map((caption) => caption.index),
    },
  };
}

export async function saveEditorialReview(rawInput: Record<string, unknown>) {
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await loadIntelligentEditPlan(planId);
  if (!plan) throw new Error("Plano inteligente não encontrado.");
  const review = reviewFor(plan, rawInput.review);
  await mkdir(plan.artifacts.directory, { recursive: true });
  await writeFile(reviewPath(plan), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  return applyEditorialReview(plan, review);
}

export async function resetEditorialReview(rawInput: Record<string, unknown>) {
  return saveEditorialReview({ planId: rawInput.planId, review: { events: [], captions: [] } });
}

export async function recordEditorialPreview(plan: IntelligentEditPlan, previewPath: string) {
  const original = await loadIntelligentEditPlan(plan.id);
  if (!original) return;
  const review = await readEditorialReview(original);
  review.previewPath = previewPath;
  review.updatedAt = new Date().toISOString();
  await writeFile(reviewPath(original), `${JSON.stringify(review, null, 2)}\n`, "utf8");
}

export async function saveCourseEditorialStandard(rawInput: Record<string, unknown>) {
  const plan = await loadIntelligentEditPlan(typeof rawInput.planId === "string" ? rawInput.planId.trim() : "");
  if (!plan?.courseName) throw new Error("Informe um curso para salvar o padrão editorial.");
  const review = await readEditorialReview(plan);
  const enabledKinds: IntelligentCourseEditorialStandard["enabledKinds"] = {};
  for (const kind of new Set(plan.events.map((event) => event.kind))) {
    const items = plan.events.filter((event) => event.kind === kind);
    enabledKinds[kind] = items.some((event) => review.events.find((change) => change.id === event.id)?.enabled !== false);
  }
  const zooms = review.events.filter((event) => event.scale !== undefined).map((event) => event.scale!);
  const standard: IntelligentCourseEditorialStandard = {
    version: 1,
    courseName: plan.courseName,
    updatedAt: new Date().toISOString(),
    captionsEnabled: review.captionsEnabled ?? plan.design?.captionsEnabled !== false,
    enabledKinds,
    ...(zooms.length ? { zoomScale: zooms.reduce((sum, scale) => sum + scale, 0) / zooms.length } : {}),
  };
  await mkdir(STANDARD_ROOT, { recursive: true });
  await writeFile(path.join(STANDARD_ROOT, `${courseId(plan.courseName)}.json`), `${JSON.stringify(standard, null, 2)}\n`, "utf8");
  return standard;
}

export async function applyCourseEditorialStandard(plan: IntelligentEditPlan) {
  if (!plan.courseName) return plan;
  const standard = await readFile(path.join(STANDARD_ROOT, `${courseId(plan.courseName)}.json`), "utf8")
    .then((raw) => JSON.parse(raw) as IntelligentCourseEditorialStandard)
    .catch(() => null);
  if (!standard || standard.version !== 1) return plan;
  const review: IntelligentEditorialReview = {
    version: 1, planId: plan.id, updatedAt: new Date().toISOString(), captionsEnabled: standard.captionsEnabled,
    events: plan.events.flatMap((event) => {
      const enabled = standard.enabledKinds[event.kind];
      const scale = event.kind === "zoom" ? standard.zoomScale : undefined;
      return enabled === undefined && scale === undefined ? [] : [{ id: event.id, ...(enabled === false ? { enabled: false } : {}), ...(scale ? { scale } : {}) }];
    }), captions: [],
  };
  await writeFile(reviewPath(plan), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  return applyEditorialReview(plan, review);
}
