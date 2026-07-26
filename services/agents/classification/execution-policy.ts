import type { ExecutionMode } from "./execution-mode.ts";
import type { ExecutionReasonCode } from "./execution-reason.ts";

export interface ExecutionPolicyRule {
  readonly id: string;
  readonly mode: ExecutionMode;
  readonly reasonCode: ExecutionReasonCode;
  readonly reasonDescription: string;
  readonly priority: number;
  readonly keywords: readonly string[];
  readonly phrases: readonly string[];
  readonly minimumMessageLength?: number;
  readonly confidence: number;
  readonly estimatedComplexity: number;
  readonly estimatedCost: number;
  readonly estimatedDuration: number;
  readonly requiredDomains: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly expectedWorkflow: readonly string[];
}

export interface ExecutionPolicy {
  readonly id: string;
  readonly version: string;
  readonly rules: readonly ExecutionPolicyRule[];
  readonly fallbackRule: ExecutionPolicyRule;
}

export function defineExecutionPolicy(
  input: ExecutionPolicy,
): ExecutionPolicy {
  const rules = input.rules.map(freezeRule);
  const fallbackRule = freezeRule(input.fallbackRule);
  const ids = [...rules, fallbackRule].map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("ExecutionPolicy rule ids must be unique.");
  }
  return Object.freeze({
    id: requireIdentifier(input.id, "ExecutionPolicy id"),
    version: requireText(input.version, "ExecutionPolicy version"),
    rules: Object.freeze(
      [...rules].sort(
        (left, right) =>
          right.priority - left.priority ||
          left.id.localeCompare(right.id),
      ),
    ),
    fallbackRule,
  });
}

function freezeRule(rule: ExecutionPolicyRule): ExecutionPolicyRule {
  validateRange(rule.priority, 0, 100, "ExecutionPolicy priority");
  validateRange(rule.confidence, 0, 1, "ExecutionPolicy confidence");
  validateRange(
    rule.estimatedComplexity,
    0,
    100,
    "ExecutionPolicy estimatedComplexity",
  );
  validateNonNegative(
    rule.estimatedCost,
    "ExecutionPolicy estimatedCost",
  );
  validateNonNegative(
    rule.estimatedDuration,
    "ExecutionPolicy estimatedDuration",
  );
  if (
    rule.minimumMessageLength !== undefined &&
    (!Number.isInteger(rule.minimumMessageLength) ||
      rule.minimumMessageLength < 0)
  ) {
    throw new Error(
      "ExecutionPolicy minimumMessageLength must be a non-negative integer.",
    );
  }
  return Object.freeze({
    ...rule,
    id: requireIdentifier(rule.id, "ExecutionPolicy rule id"),
    reasonDescription: requireText(
      rule.reasonDescription,
      "ExecutionPolicy reasonDescription",
    ),
    keywords: freezeSignals(rule.keywords),
    phrases: freezeSignals(rule.phrases),
    requiredDomains: freezeIdentifiers(rule.requiredDomains),
    requiredCapabilities: freezeIdentifiers(rule.requiredCapabilities),
    expectedWorkflow: freezeIdentifiers(rule.expectedWorkflow),
  });
}

function freezeSignals(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.map(normalizeText))].sort(),
  );
}

function freezeIdentifiers(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values.map((value) =>
      requireIdentifier(value, "ExecutionPolicy identifier").toLowerCase()
    ))],
  );
}

function normalizeText(value: string): string {
  return requireText(value, "ExecutionPolicy signal")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
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

function validateNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function validateRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
}
