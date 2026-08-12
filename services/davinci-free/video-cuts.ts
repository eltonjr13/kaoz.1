import type { IntelligentEditEvent } from "./intelligent-edit.types";

export type VideoCutRange = { start: number; end: number };

export function videoCutRanges(events: IntelligentEditEvent[], duration: number): VideoCutRange[] {
  const ranges = events
    .filter((event) => event.kind === "remove" && event.duration > 0)
    .map((event) => ({
      start: Math.max(0, Math.min(duration, event.start)),
      end: Math.max(0, Math.min(duration, event.start + event.duration)),
    }))
    .filter((range) => range.end - range.start >= 0.05)
    .sort((left, right) => left.start - right.start);

  return ranges.reduce<VideoCutRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end + 0.001) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
    return merged;
  }, []);
}

export function editedVideoDuration(events: IntelligentEditEvent[], duration: number) {
  const removed = videoCutRanges(events, duration)
    .reduce((total, range) => total + range.end - range.start, 0);
  return Math.max(0.1, duration - removed);
}

export function editedVideoTime(events: IntelligentEditEvent[], duration: number, sourceTime: number) {
  const time = Math.max(0, Math.min(duration, sourceTime));
  let removed = 0;
  for (const range of videoCutRanges(events, duration)) {
    if (time >= range.end) removed += range.end - range.start;
    else if (time > range.start) removed += time - range.start;
  }
  return Math.max(0, time - removed);
}

export function videoCutSelectExpression(events: IntelligentEditEvent[], duration: number) {
  const ranges = videoCutRanges(events, duration);
  if (!ranges.length) return null;
  const removed = ranges
    .map((range) => `between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})`)
    .join("+");
  return `not(${removed})`;
}
