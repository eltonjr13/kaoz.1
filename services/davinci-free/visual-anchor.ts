export type VisualAnchor = {
  index: number;
  x: number;
  y: number;
  confidence?: number;
};

export type SubjectAnchor = Pick<VisualAnchor, "x" | "y">;

export const DEFAULT_SUBJECT_ANCHOR: SubjectAnchor = Object.freeze({
  x: 0.5,
  y: 0.4,
});

const MIN_CONFIDENCE = 0.55;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function isReliableVisualAnchor(anchor: VisualAnchor | undefined) {
  if (!anchor) return false;
  const confidence = anchor.confidence ?? 1;
  return [
    Number.isInteger(anchor.index),
    anchor.index > 0,
    Number.isFinite(anchor.x),
    Number.isFinite(anchor.y),
    anchor.x >= 0,
    anchor.x <= 1,
    anchor.y >= 0,
    anchor.y <= 1,
    Number.isFinite(confidence),
    confidence >= MIN_CONFIDENCE,
  ].every(Boolean);
}

export function stabilizeSubjectAnchor(
  anchor: VisualAnchor | undefined,
  previous: SubjectAnchor = DEFAULT_SUBJECT_ANCHOR,
): SubjectAnchor {
  if (!anchor || !isReliableVisualAnchor(anchor)) return previous;

  // A speaker can move slightly between samples, but abrupt framing changes are
  // distracting. Keep the focus on the person while damping the movement.
  return {
    x: Number(clamp(previous.x * 0.3 + anchor.x * 0.7, 0.28, 0.72).toFixed(4)),
    y: Number(clamp(previous.y * 0.3 + anchor.y * 0.7, 0.24, 0.62).toFixed(4)),
  };
}
