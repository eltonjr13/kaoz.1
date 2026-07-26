export const ExecutionMode = Object.freeze({
  QUICK: "QUICK",
  ANALYSIS: "ANALYSIS",
  EXECUTION: "EXECUTION",
  BACKGROUND: "BACKGROUND",
  STREAMING: "STREAMING",
} as const);

export type ExecutionMode =
  (typeof ExecutionMode)[keyof typeof ExecutionMode];

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return Object.values(ExecutionMode).includes(value as ExecutionMode);
}
