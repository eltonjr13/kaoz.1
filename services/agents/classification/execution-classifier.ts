import { DEFAULT_EXECUTION_POLICY } from "./default-execution-policy.ts";
import {
  createExecutionDecision,
  type ExecutionDecision,
} from "./execution-decision.ts";
import type {
  ExecutionPolicy,
  ExecutionPolicyRule,
} from "./execution-policy.ts";

export interface ExecutionClassificationInput {
  readonly message: string;
}

export interface ExecutionClassifier {
  classify(input: ExecutionClassificationInput): ExecutionDecision;
}

export class PolicyBasedExecutionClassifier
  implements ExecutionClassifier {
  private readonly policy: ExecutionPolicy;

  constructor(policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY) {
    this.policy = policy;
  }

  classify(input: ExecutionClassificationInput): ExecutionDecision {
    const message = requireMessage(input.message);
    const normalized = normalizeText(message);
    const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
    const matched = this.policy.rules
      .map((rule) => matchRule(rule, normalized, tokens))
      .find((result) => result !== undefined);
    const selected = matched ?? {
      rule: this.policy.fallbackRule,
      signals: Object.freeze([]),
    };

    return createExecutionDecision({
      mode: selected.rule.mode,
      confidence: selected.rule.confidence,
      reason: {
        code: selected.rule.reasonCode,
        description: selected.rule.reasonDescription,
        matchedSignals: selected.signals,
        policyRuleId: selected.rule.id,
      },
      estimatedComplexity: selected.rule.estimatedComplexity,
      estimatedCost: selected.rule.estimatedCost,
      estimatedDuration: selected.rule.estimatedDuration,
      requiredDomains: selected.rule.requiredDomains,
      requiredCapabilities: selected.rule.requiredCapabilities,
      expectedWorkflow: selected.rule.expectedWorkflow,
    });
  }
}

function matchRule(
  rule: ExecutionPolicyRule,
  message: string,
  tokens: ReadonlySet<string>,
):
  | {
      readonly rule: ExecutionPolicyRule;
      readonly signals: readonly string[];
    }
  | undefined {
  const matchedSignals = [
    ...rule.keywords.filter((keyword) => tokens.has(keyword)),
    ...rule.phrases.filter((phrase) => message.includes(phrase)),
  ];
  const lengthMatched =
    rule.minimumMessageLength !== undefined &&
    message.length >= rule.minimumMessageLength;
  if (matchedSignals.length === 0 && !lengthMatched) {
    return undefined;
  }
  return Object.freeze({
    rule,
    signals: Object.freeze(
      lengthMatched && matchedSignals.length === 0
        ? [`message-length>=${rule.minimumMessageLength}`]
        : matchedSignals,
    ),
  });
}

function requireMessage(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(
      "ExecutionClassifier message must not be empty.",
    );
  }
  return normalized;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
