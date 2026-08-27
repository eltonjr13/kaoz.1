import type { IntelligentCaption } from "./intelligent-edit.types";

export type KaraokeCaptionSlice = {
  start: number;
  end: number;
  words: string[];
  activeIndex: number;
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
  return words.flatMap((word, index) => {
    const start = index === 0
      ? caption.start
      : Math.max(caption.start, Math.min(caption.end, word.start));
    const nextStart = words[index + 1]?.start ?? caption.end;
    const end = Math.max(start, Math.min(caption.end, nextStart));
    if (end <= start) return [];
    return [{ start, end, words: words.map((item) => item.text), activeIndex: index }];
  });
}

export function activeKaraokeWordIndex(caption: IntelligentCaption, playheadTime: number) {
  const words = caption.words?.filter((word) => word.end > word.start) || [];
  if (words.length) {
    const activeIndex = words.findIndex((word) => playheadTime >= word.start && playheadTime < word.end);
    if (activeIndex >= 0) return activeIndex;
    const nextIndex = words.findIndex((word) => playheadTime < word.start);
    return nextIndex < 0 ? words.length - 1 : Math.max(0, nextIndex - 1);
  }
  const wordCount = caption.text.split(/\s+/).filter(Boolean).length;
  const progress = (playheadTime - caption.start) / Math.max(0.04, caption.end - caption.start);
  return Math.min(wordCount - 1, Math.max(0, Math.floor(progress * wordCount)));
}
