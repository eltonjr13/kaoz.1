import type { MeetingSegment, MeetingSession } from "./meeting-notes-store";

export interface MeetingDigestItem {
  text: string;
  segmentId: string;
  startMs: number;
}

export interface MeetingDigest {
  summary: MeetingDigestItem[];
  decisions: MeetingDigestItem[];
  actions: MeetingDigestItem[];
}

/** Extractive only: each item points to a verbatim transcript segment. */
export function summarizeMeeting(session: MeetingSession): MeetingDigest {
  const usable = session.segments.filter((segment) => segment.text.trim());
  const item = (segment: MeetingSegment): MeetingDigestItem => ({
    text: segment.text,
    segmentId: segment.id,
    startMs: segment.startMs,
  });
  const explicitDecision = /\b(decidimos|decidido|decidida|ficou definido|ficou definida|a decis[aã]o|aprovamos)\b/i;
  const explicitAction = /\b(pr[oó]ximo passo|tarefa|precisamos|vamos fazer|vou fazer|ficou de fazer|respons[aá]vel por)\b/i;
  const unique = (segments: MeetingSegment[]) => [...new Map(segments.map((segment) => [segment.id, segment])).values()];

  return {
    summary: unique([
      ...usable.filter((segment) => segment.tag === "highlight"),
      ...usable.filter((segment) => segment.tag === "decision" || segment.tag === "action"),
      ...usable,
    ]).slice(0, 6).map(item),
    decisions: usable.filter((segment) => segment.tag === "decision" || explicitDecision.test(segment.text)).map(item),
    actions: usable.filter((segment) => segment.tag === "action" || explicitAction.test(segment.text)).map(item),
  };
}
