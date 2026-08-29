import type { IntelligentCaption } from "./intelligent-edit.types";

export type KaraokeCaptionSlice = {
  start: number;
  end: number;
  words: string[];
  activeIndex: number;
  completedIndex: number;
};

export type KaraokeWordState = {
  activeIndex: number;
  completedIndex: number;
};

function displayWords(caption: IntelligentCaption, displayText: string) {
  const words = caption.text.split(/\s+/).filter(Boolean);
  const suffix = displayText.startsWith(caption.text)
    ? displayText.slice(caption.text.length).trim()
    : "";
  if (suffix && words.length) words[words.length - 1] = `${words[words.length - 1]} ${suffix}`;
  return suffix ? words : displayText.split(/\s+/).filter(Boolean);
}

function timedWords(caption: IntelligentCaption, words: string[]) {
  const duration = Math.max(0.04, caption.end - caption.start);
  const preciseWords = caption.words?.filter(
    (word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start,
  );
  return words.map((text, index) => ({
    text,
    start: preciseWords?.[index]?.start ?? caption.start + (duration * index) / words.length,
    end: preciseWords?.[index]?.end ?? caption.start + (duration * (index + 1)) / words.length,
  }));
}

export function karaokeCaptionSlices(
  caption: IntelligentCaption,
  displayText = caption.text,
): KaraokeCaptionSlice[] {
  const words = timedWords(caption, displayWords(caption, displayText));
  const display = words.map((item) => item.text);
  const slices: KaraokeCaptionSlice[] = [];
  let cursor = caption.start;

  words.forEach((word, index) => {
    const start = Math.max(cursor, Math.max(caption.start, Math.min(caption.end, word.start)));
    const nextStart = words[index + 1]?.start;
    const end = Math.max(
      start,
      Math.min(caption.end, word.end, nextStart === undefined ? caption.end : Math.max(start, nextStart)),
    );
    if (start > cursor) {
      slices.push({ start: cursor, end: start, words: display, activeIndex: -1, completedIndex: index - 1 });
    }
    if (end > start) {
      slices.push({ start, end, words: display, activeIndex: index, completedIndex: index - 1 });
      cursor = end;
    }
  });

  if (cursor < caption.end) {
    slices.push({
      start: cursor,
      end: caption.end,
      words: display,
      activeIndex: -1,
      completedIndex: words.length - 1,
    });
  }
  return slices;
}

export function karaokeWordState(caption: IntelligentCaption, playheadTime: number): KaraokeWordState {
  const words = caption.words?.filter((word) => word.end > word.start) || [];
  if (words.length) {
    const activeIndex = words.findIndex((word) => playheadTime >= word.start && playheadTime < word.end);
    const completedIndex = words.reduce(
      (latest, word, index) => word.end <= playheadTime ? index : latest,
      -1,
    );
    return { activeIndex, completedIndex };
  }
  const wordCount = caption.text.split(/\s+/).filter(Boolean).length;
  const progress = (playheadTime - caption.start) / Math.max(0.04, caption.end - caption.start);
  const activeIndex = Math.min(wordCount - 1, Math.max(0, Math.floor(progress * wordCount)));
  return { activeIndex, completedIndex: activeIndex - 1 };
}

export function activeKaraokeWordIndex(caption: IntelligentCaption, playheadTime: number) {
  return karaokeWordState(caption, playheadTime).activeIndex;
}
