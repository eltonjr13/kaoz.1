import {
  createExecutionReason,
  type ExecutionReason,
} from "./execution-reason.ts";
import {
  isExecutionMode,
  type ExecutionMode,
} from "./execution-mode.ts";

export interface ExecutionDecision {
  readonly mode: ExecutionMode;
  readonly confidence: number;
  readonly reason: ExecutionReason;
  readonly estimatedComplexity: number;
  readonly estimatedCost: number;
  readonly estimatedDuration: number;
  readonly requiredDomains: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly expectedWorkflow: readonly string[];
}

export function createExecutionDecision(
  input: ExecutionDecision,
): ExecutionDecision {
  if (!isExecutionMode(input.mode)) {
    throw new Error("ExecutionDecision mode is invalid.");
  }
  return Object.freeze({
    mode: input.mode,
    confidence: range(
      input.confidence,
      0,
      1,
      "ExecutionDecision confidence",
    ),
    reason: createExecutionReason(input.reason),
    estimatedComplexity: range(
      input.estimatedComplexity,
      0,
      100,
      "ExecutionDecision estimatedComplexity",
    ),
    estimatedCost: nonNegative(
      input.estimatedCost,
      "ExecutionDecision estimatedCost",
    ),
    estimatedDuration: nonNegative(
      input.estimatedDuration,
      "ExecutionDecision estimatedDuration",
    ),
    requiredDomains: freezeIdentifiers(
      input.requiredDomains,
      "ExecutionDecision required domain",
    ),
    requiredCapabilities: freezeIdentifiers(
      input.requiredCapabilities,
      "ExecutionDecision required capability",
    ),
    expectedWorkflow: freezeIdentifiers(
      input.expectedWorkflow,
      "ExecutionDecision workflow step",
    ),
  });
}

function freezeIdentifiers(
  values: readonly string[],
  label: string,
): readonly string[] {
  const normalized = values.map((value) => {
    const item = value.trim().toLowerCase();
    if (!item || /\s/.test(item)) {
      throw new Error(`${label} must be an identifier without spaces.`);
    }
    return item;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} values must be unique.`);
  }
  return Object.freeze(normalized);
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function range(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
