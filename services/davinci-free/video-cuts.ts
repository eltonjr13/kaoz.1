import type { IntelligentEditEvent } from "./intelligent-edit.types";

export type VideoCutRange = { start: number; end: number };

export type VideoActiveClip = {
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
};

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

export function videoActiveClips(events: IntelligentEditEvent[], duration: number): VideoActiveClip[] {
  if (duration <= 0) return [];
  const cuts = videoCutRanges(events, duration);
  if (!cuts.length) {
    return [{
      id: "clip-0",
      index: 0,
      start: 0,
      end: duration,
      duration: Math.round(duration * 100) / 100,
    }];
  }

  const clips: VideoActiveClip[] = [];
  let cursor = 0;

  for (const cut of cuts) {
    if (cut.start - cursor >= 0.05) {
      const start = Math.round(cursor * 100) / 100;
      const end = Math.round(cut.start * 100) / 100;
      clips.push({
        id: `clip-${clips.length}`,
        index: clips.length,
        start,
        end,
        duration: Math.max(0.05, Math.round((end - start) * 100) / 100),
      });
    }
    cursor = Math.max(cursor, cut.end);
  }

  if (duration - cursor >= 0.05) {
    const start = Math.round(cursor * 100) / 100;
    const end = Math.round(duration * 100) / 100;
    clips.push({
      id: `clip-${clips.length}`,
      index: clips.length,
      start,
      end,
      duration: Math.max(0.05, Math.round((end - start) * 100) / 100),
    });
  }

  return clips;
}

export function findActiveClipAtTime(clips: VideoActiveClip[], time: number): VideoActiveClip | null {
  if (!clips.length) return null;
  const direct = clips.find((c) => time >= c.start && time <= c.end);
  if (direct) return direct;
  let closest = clips[0];
  let minDistance = Math.abs(time - (closest.start + closest.end) / 2);
  for (let i = 1; i < clips.length; i += 1) {
    const dist = Math.abs(time - (clips[i].start + clips[i].end) / 2);
    if (dist < minDistance) {
      minDistance = dist;
      closest = clips[i];
    }
  }
  return closest;
}

export function detectSilenceRanges(
  waveformPeaks: number[],
  duration: number,
  options: { minSilenceDuration?: number; threshold?: number; padding?: number } = {},
): VideoCutRange[] {
  if (!waveformPeaks.length || duration <= 0) return [];
  const minSilence = options.minSilenceDuration ?? 0.4;
  const threshold = options.threshold ?? 0.045;
  const padding = options.padding ?? 0.08;
  const pointCount = waveformPeaks.length;

  const rawRanges: VideoCutRange[] = [];
  let silenceStartIdx: number | null = null;

  for (let i = 0; i < pointCount; i += 1) {
    const isSilent = waveformPeaks[i] <= threshold;
    if (isSilent && silenceStartIdx === null) {
      silenceStartIdx = i;
    } else if (!isSilent && silenceStartIdx !== null) {
      const startSec = (silenceStartIdx / pointCount) * duration;
      const endSec = (i / pointCount) * duration;
      if (endSec - startSec >= minSilence) {
        const safeStart = Math.min(duration, startSec + padding);
        const safeEnd = Math.max(0, endSec - padding);
        if (safeEnd - safeStart >= 0.15) {
          rawRanges.push({
            start: Math.round(safeStart * 100) / 100,
            end: Math.round(safeEnd * 100) / 100,
          });
        }
      }
      silenceStartIdx = null;
    }
  }

  if (silenceStartIdx !== null) {
    const startSec = (silenceStartIdx / pointCount) * duration;
    const endSec = duration;
    if (endSec - startSec >= minSilence) {
      const safeStart = Math.min(duration, startSec + padding);
      const safeEnd = Math.max(0, endSec - padding);
      if (safeEnd - safeStart >= 0.15) {
        rawRanges.push({
          start: Math.round(safeStart * 100) / 100,
          end: Math.round(safeEnd * 100) / 100,
        });
      }
    }
  }

  return rawRanges;
}

export function nextPlayheadAfterCuts(
  sourceTime: number,
  cutRanges: VideoCutRange[],
): { jumped: boolean; newTime: number } {
  for (const cut of cutRanges) {
    if (sourceTime >= cut.start && sourceTime < cut.end) {
      return { jumped: true, newTime: Math.min(cut.end + 0.03, cut.end) };
    }
  }
  return { jumped: false, newTime: sourceTime };
}

