import type { SpeechTimedSegment, SpeechTimedWord, SpeechTimingPrecision } from "./speech.types";

type NormalizedSpeechTiming = {
  words: SpeechTimedWord[];
  segments: SpeechTimedSegment[];
  timingPrecision: SpeechTimingPrecision;
};

function seconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return Number.NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parts = value.replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function firstFinite(...values: number[]) {
  return values.find(Number.isFinite) ?? Number.NaN;
}

function bounds(value: Record<string, unknown>) {
  const offsets = value.offsets && typeof value.offsets === "object"
    ? value.offsets as Record<string, unknown>
    : undefined;
  const timestamps = value.timestamps && typeof value.timestamps === "object"
    ? value.timestamps as Record<string, unknown>
    : undefined;
  const offsetStart = offsets ? seconds(offsets.from) / 1_000 : Number.NaN;
  const offsetEnd = offsets ? seconds(offsets.to) / 1_000 : Number.NaN;
  return {
    start: firstFinite(seconds(value.start), offsetStart, seconds(timestamps?.from)),
    end: firstFinite(seconds(value.end), offsetEnd, seconds(timestamps?.to)),
  };
}

function timedText(item: Record<string, unknown>) {
  if (typeof item.text === "string") return item.text.trim();
  return typeof item.word === "string" ? item.word.trim() : "";
}

function validBounds(start: number, end: number) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
}

function word(value: unknown): SpeechTimedWord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const { start, end } = bounds(item);
  const text = timedText(item);
  if (!text || !validBounds(start, end)) return null;
  const confidence = Number(item.confidence ?? item.probability);
  return { start, end, text, ...(Number.isFinite(confidence) ? { confidence } : {}) };
}

function words(value: unknown) {
  return Array.isArray(value) ? value.map(word).filter((item): item is SpeechTimedWord => Boolean(item)) : [];
}

function segment(value: unknown): SpeechTimedSegment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const { start, end } = bounds(item);
  const text = typeof item.text === "string" ? item.text.trim() : "";
  if (!text || !validBounds(start, end)) return null;
  const timedWords = words(item.words ?? item.tokens);
  return { start, end, text, ...(timedWords.length ? { words: timedWords } : {}) };
}

export function normalizeSpeechTiming(payload: unknown): NormalizedSpeechTiming {
  const data = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const rawSegments = Array.isArray(data.segments) ? data.segments : data.transcription;
  const segments = (Array.isArray(rawSegments) ? rawSegments : [])
    .map(segment)
    .filter((item): item is SpeechTimedSegment => Boolean(item));
  const directWords = words(data.words);
  const timedWords = directWords.length ? directWords : segments.flatMap((item) => item.words || []);
  const declared = timingPrecision(data.timingPrecision);
  return {
    words: timedWords,
    segments,
    timingPrecision: declared || (timedWords.length ? "precise" : "approximate"),
  };
}

function timingPrecision(value: unknown): SpeechTimingPrecision | undefined {
  if (value === "precise") return value;
  return value === "approximate" ? value : undefined;
}
