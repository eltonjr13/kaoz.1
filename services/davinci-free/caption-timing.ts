import type {
  IntelligentCaption,
  IntelligentEditorialCaptionOverride,
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

function timeAtActiveOffset(intervals: SpeechInterval[], offset: number, preferNext = false) {
  let remaining = Math.max(0, offset);
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    const duration = interval.end - interval.start;
    if (remaining < duration || (!preferNext && remaining === duration) || index === intervals.length - 1) {
      return interval.start + Math.min(remaining, duration);
    }
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
    const wordStart = timeAtActiveOffset(active, (consumed / totalWeight) * activeDuration, true);
    consumed += weights[index];
    const allocatedEnd = timeAtActiveOffset(active, (consumed / totalWeight) * activeDuration);
    const containingInterval = active.find((interval) => wordStart >= interval.start && wordStart < interval.end);
    const wordEnd = containingInterval ? Math.min(containingInterval.end, allocatedEnd) : allocatedEnd;
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
