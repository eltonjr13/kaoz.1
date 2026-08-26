import type {
  IntelligentCaption,
  IntelligentTimedWord,
  IntelligentTimingPrecision,
  TimedTranscriptSegment,
} from "./intelligent-edit.types";

export type SpeechInterval = { start: number; end: number };

function cleanWord(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function wordWeight(value: string) {
  return Math.max(1, cleanWord(value).replace(/[^\p{L}\p{N}]/gu, "").length * 0.45 + 1);
}

function intersectingIntervals(start: number, end: number, intervals: SpeechInterval[]) {
  const matches = intervals
    .map((interval) => ({ start: Math.max(start, interval.start), end: Math.min(end, interval.end) }))
    .filter((interval) => interval.end - interval.start >= 0.04);
  return matches.length ? matches : [{ start, end }];
}

function timeAtActiveOffset(intervals: SpeechInterval[], offset: number) {
  let remaining = Math.max(0, offset);
  for (const interval of intervals) {
    const duration = interval.end - interval.start;
    if (remaining <= duration) return interval.start + remaining;
    remaining -= duration;
  }
  return intervals.at(-1)?.end || 0;
}

export function approximateTimedWords(
  text: string,
  start: number,
  end: number,
  speechIntervals: SpeechInterval[] = [],
): IntelligentTimedWord[] {
  const tokens = text.split(/\s+/).map(cleanWord).filter(Boolean);
  if (!tokens.length || end <= start) return [];
  const active = intersectingIntervals(start, end, speechIntervals);
  const activeDuration = active.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  const weights = tokens.map(wordWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let consumed = 0;
  return tokens.map((token, index) => {
    const wordStart = timeAtActiveOffset(active, (consumed / totalWeight) * activeDuration);
    consumed += weights[index];
    const wordEnd = timeAtActiveOffset(active, (consumed / totalWeight) * activeDuration);
    return {
      start: wordStart,
      end: Math.max(wordStart + 0.04, Math.min(end, wordEnd)),
      text: token,
    };
  });
}

function normalizeWords(words: IntelligentTimedWord[], duration: number) {
  const ordered = words
    .map((word) => ({
      ...word,
      text: cleanWord(word.text),
      start: Math.max(0, Math.min(duration, word.start)),
      end: Math.max(0, Math.min(duration, word.end)),
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  return ordered.filter((word, index) => {
    const previous = ordered[index - 1];
    if (!previous) return true;
    const sameText = previous.text.localeCompare(word.text, "pt", { sensitivity: "base" }) === 0;
    return !(sameText && word.start < previous.end + 0.08);
  });
}

function shouldBreak(words: IntelligentTimedWord[], next?: IntelligentTimedWord) {
  const text = words.map((word) => word.text).join(" ");
  const last = words.at(-1);
  return words.length >= 7
    || text.length >= 82
    || Boolean(last && /[.!?…][\]"')]*$/u.test(last.text))
    || Boolean(last && next && next.start - last.end >= 0.3);
}

function captionFromWords(words: IntelligentTimedWord[], previousEnd: number, nextStart: number | undefined) {
  const first = words[0];
  const last = words.at(-1)!;
  const desiredStart = Math.max(0, first.start - 0.08);
  const desiredEnd = last.end + 0.12;
  const start = Math.max(previousEnd, desiredStart);
  const endLimit = nextStart === undefined ? desiredEnd : Math.max(last.end, nextStart - 0.02);
  return {
    start,
    end: Math.max(start + 0.1, Math.min(desiredEnd, endLimit)),
    text: words.map((word) => word.text).join(" "),
    words,
  } satisfies IntelligentCaption;
}

export function captionsFromTranscript(
  segments: TimedTranscriptSegment[],
  duration: number,
  speechIntervals: SpeechInterval[] = [],
): IntelligentCaption[] {
  const words = normalizeWords(segments.flatMap((segment) => segment.words?.length
    ? segment.words
    : approximateTimedWords(segment.text, segment.start, segment.end, speechIntervals)), duration);
  const groups: IntelligentTimedWord[][] = [];
  let current: IntelligentTimedWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    current.push(words[index]);
    if (shouldBreak(current, words[index + 1])) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  let previousEnd = 0;
  return groups.map((group, index) => {
    const caption = captionFromWords(group, previousEnd, groups[index + 1]?.[0]?.start);
    previousEnd = caption.end;
    return caption;
  });
}

export function transcriptTimingPrecision(segments: TimedTranscriptSegment[]): IntelligentTimingPrecision {
  return segments.length > 0 && segments.every((segment) => segment.timingPrecision === "precise" && segment.words?.length)
    ? "precise"
    : "approximate";
}
