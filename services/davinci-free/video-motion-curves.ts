export type TimedMotionEvent = { start: number; duration: number };

export function smoothStep(progress: number) {
  const value = Math.max(0, Math.min(1, progress));
  return value * value * (3 - 2 * value);
}

export function motionRampTiming(event: TimedMotionEvent) {
  const entry = Math.max(0.4, Math.min(0.8, event.duration * 0.28));
  const exit = Math.max(0.35, Math.min(0.65, event.duration * 0.24));
  return {
    start: event.start,
    rampEnd: event.start + entry,
    holdEnd: event.start + Math.max(entry, event.duration - exit),
    end: event.start + event.duration,
    entry,
    exit,
  };
}

export function transitionTiming(event: TimedMotionEvent) {
  const half = Math.max(0.12, event.duration / 2);
  return { start: Math.max(0, event.start - half), middle: event.start, end: event.start + half, half };
}

export function transitionEnvelope(event: TimedMotionEvent, time: number) {
  const timing = transitionTiming(event);
  if (time < timing.start || time > timing.end) return 0;
  return time <= timing.middle
    ? smoothStep((time - timing.start) / timing.half)
    : smoothStep(1 - (time - timing.middle) / timing.half);
}
