export type ExecutionReasonCode =
  | "explicit-streaming-request"
  | "explicit-background-request"
  | "action-required"
  | "deliberate-analysis-required"
  | "quick-path"
  | "policy-rule";

export interface ExecutionReason {
  readonly code: ExecutionReasonCode;
  readonly description: string;
  readonly matchedSignals: readonly string[];
  readonly policyRuleId: string;
}

export function createExecutionReason(
  input: ExecutionReason,
): ExecutionReason {
  return Object.freeze({
    code: normalizeReasonCode(input.code),
    description: requireText(
      input.description,
      "ExecutionReason description",
    ),
    matchedSignals: Object.freeze(
      [...new Set(input.matchedSignals.map(normalizeSignal))],
    ),
    policyRuleId: requireIdentifier(
      input.policyRuleId,
      "ExecutionReason policyRuleId",
    ),
  });
}

function normalizeReasonCode(
  value: ExecutionReasonCode,
): ExecutionReasonCode {
  const supported: readonly ExecutionReasonCode[] = [
    "explicit-streaming-request",
    "explicit-background-request",
    "action-required",
    "deliberate-analysis-required",
    "quick-path",
    "policy-rule",
  ];
  if (!supported.includes(value)) {
    throw new Error("ExecutionReason code is invalid.");
  }
  return value;
}

function normalizeSignal(value: string): string {
  return requireText(value, "ExecutionReason signal").toLowerCase();
}

function requireIdentifier(value: string, label: string): string {
  const normalized = requireText(value, label);
  if (/\s/.test(normalized)) {
    throw new Error(`${label} must not contain spaces.`);
  }
  return normalized;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
