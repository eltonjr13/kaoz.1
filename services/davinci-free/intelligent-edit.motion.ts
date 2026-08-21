import type {
  IntelligentEditEvent,
  IntelligentEditStyle,
  IntelligentMotionPace,
} from "./intelligent-edit.types";

export type IntelligentMotionProfile = {
  pace: IntelligentMotionPace;
  cardDuration: number;
  lowerThirdDuration: number;
  impactDuration: number;
  zoomDuration: number;
  transitionDuration: number;
  zoomScale: number;
  entranceSeconds: number;
  exitSeconds: number;
  minimumStrongEffectGap: number;
  visualStagger: number;
  transitionDarkness: number;
};

const MOTION_PROFILES: Record<IntelligentMotionPace, IntelligentMotionProfile> = {
  calm: {
    pace: "calm",
    cardDuration: 4,
    lowerThirdDuration: 5.2,
    impactDuration: 3.8,
    zoomDuration: 3.4,
    transitionDuration: 0.95,
    zoomScale: 1.075,
    entranceSeconds: 0.72,
    exitSeconds: 0.58,
    minimumStrongEffectGap: 2.2,
    visualStagger: 0.42,
    transitionDarkness: 0.16,
  },
  natural: {
    pace: "natural",
    cardDuration: 4,
    lowerThirdDuration: 4.8,
    impactDuration: 3.3,
    zoomDuration: 2.9,
    transitionDuration: 0.8,
    zoomScale: 1.09,
    entranceSeconds: 0.62,
    exitSeconds: 0.48,
    minimumStrongEffectGap: 1.8,
    visualStagger: 0.34,
    transitionDarkness: 0.2,
  },
  energetic: {
    pace: "energetic",
    cardDuration: 4,
    lowerThirdDuration: 4.5,
    impactDuration: 3,
    zoomDuration: 2.4,
    transitionDuration: 0.68,
    zoomScale: 1.105,
    entranceSeconds: 0.54,
    exitSeconds: 0.42,
    minimumStrongEffectGap: 1.5,
    visualStagger: 0.28,
    transitionDarkness: 0.24,
  },
};

export function defaultMotionPace(style: IntelligentEditStyle): IntelligentMotionPace {
  if (style === "subtle") return "calm";
  if (style === "dynamic" || style === "meme") return "energetic";
  return "natural";
}

export function normalizeMotionPace(
  value: unknown,
  style: IntelligentEditStyle = "balanced",
): IntelligentMotionPace {
  return value === "calm" || value === "natural" || value === "energetic"
    ? value
    : defaultMotionPace(style);
}

export function resolveMotionProfile(
  pace: IntelligentMotionPace | undefined,
  style: IntelligentEditStyle = "balanced",
): IntelligentMotionProfile {
  return MOTION_PROFILES[normalizeMotionPace(pace, style)];
}

export function motionEventDuration(
  kind: IntelligentEditEvent["kind"],
  profile: IntelligentMotionProfile,
) {
  if (kind === "intro" || kind === "outro") return profile.cardDuration;
  if (kind === "lower-third") return profile.lowerThirdDuration;
  if (kind === "impact-text") return profile.impactDuration;
  if (kind === "zoom") return profile.zoomDuration;
  if (kind === "transition") return profile.transitionDuration;
  return undefined;
}

function boundedStart(event: IntelligentEditEvent, duration: number) {
  return Math.max(0, Math.min(event.start, Math.max(0, duration - event.duration)));
}

export function composeMotionEvents(
  events: IntelligentEditEvent[],
  duration: number,
  profile: IntelligentMotionProfile,
) {
  const ordered = events.map((event) => ({ ...event })).sort((left, right) => left.start - right.start);
  let previousTextEnd = Number.NEGATIVE_INFINITY;
  let previousTransition = Number.NEGATIVE_INFINITY;
  let previousZoomStart = Number.NEGATIVE_INFINITY;

  for (const event of ordered) {
    if (event.kind === "intro" || event.kind === "outro" || event.kind === "remove") continue;
    event.start = boundedStart(event, duration);

    if (event.kind === "lower-third" || event.kind === "impact-text") {
      event.start = Math.max(event.start, previousTextEnd + profile.minimumStrongEffectGap);
      const nearbyZoom = ordered.find(
        (candidate) => candidate.kind === "zoom" && Math.abs(candidate.start - event.start) < 0.08,
      );
      if (nearbyZoom) event.start += profile.visualStagger;
      event.start = boundedStart(event, duration);
      previousTextEnd = event.start + event.duration;
    }

    if (event.kind === "transition") {
      event.start = Math.max(event.start, previousTransition + profile.minimumStrongEffectGap);
      event.start = boundedStart(event, duration);
      previousTransition = event.start;
    }

    if (event.kind === "zoom") {
      event.start = Math.max(event.start, previousZoomStart + event.duration + profile.minimumStrongEffectGap);
      event.start = boundedStart(event, duration);
      previousZoomStart = event.start;
    }
  }

  return ordered.sort((left, right) => left.start - right.start);
}
