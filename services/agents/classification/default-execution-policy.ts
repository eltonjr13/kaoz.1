import { ExecutionMode } from "./execution-mode.ts";
import {
  defineExecutionPolicy,
  type ExecutionPolicy,
  type ExecutionPolicyRule,
} from "./execution-policy.ts";

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy =
  defineExecutionPolicy({
    id: "default-execution-policy",
    version: "1.0.0",
    rules: [
      rule({
        id: "streaming",
        mode: ExecutionMode.STREAMING,
        reasonCode: "explicit-streaming-request",
        reasonDescription:
          "The message explicitly requires progressive or real-time output.",
        priority: 100,
        keywords: ["streaming"],
        phrases: ["em tempo real", "resposta progressiva", "ao vivo"],
        confidence: 0.98,
        estimatedComplexity: 55,
        estimatedCost: 2,
        estimatedDuration: 120_000,
        requiredCapabilities: ["streaming"],
        expectedWorkflow: [
          "open-stream",
          "process-incrementally",
          "close-stream",
        ],
      }),
      rule({
        id: "background",
        mode: ExecutionMode.BACKGROUND,
        reasonCode: "explicit-background-request",
        reasonDescription:
          "The message requests deferred, recurring or monitored work.",
        priority: 90,
        keywords: ["monitore", "acompanhe"],
        phrases: [
          "em segundo plano",
          "execute depois",
          "continue monitorando",
        ],
        confidence: 0.96,
        estimatedComplexity: 65,
        estimatedCost: 3,
        estimatedDuration: 600_000,
        requiredCapabilities: ["background-execution"],
        expectedWorkflow: [
          "plan",
          "schedule-background",
          "monitor",
          "report",
        ],
      }),
      rule({
        id: "execution",
        mode: ExecutionMode.EXECUTION,
        reasonCode: "action-required",
        reasonDescription:
          "The message requests a state-changing or artifact-producing action.",
        priority: 80,
        keywords: [
          "adicione",
          "configure",
          "corrija",
          "crie",
          "execute",
          "gere",
          "implemente",
          "modifique",
          "publique",
          "remova",
        ],
        phrases: [],
        confidence: 0.94,
        estimatedComplexity: 70,
        estimatedCost: 3,
        estimatedDuration: 180_000,
        requiredCapabilities: ["planning", "task-execution"],
        expectedWorkflow: [
          "plan",
          "decompose",
          "schedule",
          "execute",
          "supervise",
          "consolidate",
        ],
      }),
      rule({
        id: "analysis",
        mode: ExecutionMode.ANALYSIS,
        reasonCode: "deliberate-analysis-required",
        reasonDescription:
          "The message requests investigation, comparison or extended reasoning.",
        priority: 70,
        keywords: [
          "analise",
          "compare",
          "diagnostique",
          "explique",
          "investigue",
          "revise",
        ],
        phrases: ["por que", "quais sao as causas"],
        minimumMessageLength: 240,
        confidence: 0.9,
        estimatedComplexity: 45,
        estimatedCost: 1,
        estimatedDuration: 45_000,
        requiredCapabilities: ["analysis"],
        expectedWorkflow: ["analyze", "validate", "respond"],
      }),
    ],
    fallbackRule: rule({
      id: "quick",
      mode: ExecutionMode.QUICK,
      reasonCode: "quick-path",
      reasonDescription:
        "No signal requires extended analysis or managed execution.",
      priority: 0,
      keywords: [],
      phrases: [],
      confidence: 0.85,
      estimatedComplexity: 10,
      estimatedCost: 0,
      estimatedDuration: 5_000,
      requiredCapabilities: [],
      expectedWorkflow: ["respond"],
    }),
  });

function rule(
  input: Omit<
    ExecutionPolicyRule,
    "requiredDomains"
  > & { readonly requiredDomains?: readonly string[] },
): ExecutionPolicyRule {
  return {
    ...input,
    requiredDomains: input.requiredDomains ?? [],
  };
}
