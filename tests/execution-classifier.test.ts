import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ExecutionMode,
  PolicyBasedExecutionClassifier,
  createExecutionDecision,
  defineExecutionPolicy,
} from "../services/agents/index.ts";

test("classifies every supported execution mode deterministically", () => {
  const classifier = new PolicyBasedExecutionClassifier();
  const cases = [
    ["Qual é a capital do Brasil?", ExecutionMode.QUICK, "quick"],
    [
      "Analise as causas deste comportamento.",
      ExecutionMode.ANALYSIS,
      "analysis",
    ],
    [
      "Implemente a nova camada no projeto.",
      ExecutionMode.EXECUTION,
      "execution",
    ],
    [
      "Monitore esta operação em segundo plano.",
      ExecutionMode.BACKGROUND,
      "background",
    ],
    [
      "Envie o resultado em tempo real.",
      ExecutionMode.STREAMING,
      "streaming",
    ],
  ] as const;

  for (const [message, mode, ruleId] of cases) {
    const decision = classifier.classify({ message });

    assert.equal(decision.mode, mode, message);
    assert.equal(decision.reason.policyRuleId, ruleId, message);
    assert.equal(decision.confidence > 0, true);
    assert.equal(decision.estimatedComplexity >= 0, true);
    assert.equal(decision.estimatedCost >= 0, true);
    assert.equal(decision.estimatedDuration >= 0, true);
    assert.equal(Array.isArray(decision.requiredDomains), true);
    assert.equal(Array.isArray(decision.requiredCapabilities), true);
    assert.equal(Array.isArray(decision.expectedWorkflow), true);
    assert.equal(Object.isFrozen(decision), true);
    assert.equal(Object.isFrozen(decision.reason), true);
    assert.equal(Object.isFrozen(decision.expectedWorkflow), true);
    assert.equal("answer" in decision, false);
    assert.equal("response" in decision, false);
  }
});

test("policy priority selects streaming and background before generic execution", () => {
  const classifier = new PolicyBasedExecutionClassifier();

  assert.equal(
    classifier.classify({
      message: "Execute e publique o acompanhamento em tempo real.",
    }).mode,
    ExecutionMode.STREAMING,
  );
  assert.equal(
    classifier.classify({
      message: "Execute depois e continue monitorando.",
    }).mode,
    ExecutionMode.BACKGROUND,
  );
});

test("supports immutable custom policies without changing the classifier", () => {
  const policy = defineExecutionPolicy({
    id: "custom-policy",
    version: "1.0.0",
    rules: [
      {
        id: "triage",
        mode: ExecutionMode.ANALYSIS,
        reasonCode: "policy-rule",
        reasonDescription: "Custom triage policy.",
        priority: 50,
        keywords: ["triagem"],
        phrases: [],
        confidence: 0.77,
        estimatedComplexity: 30,
        estimatedCost: 2,
        estimatedDuration: 12_000,
        requiredDomains: ["support"],
        requiredCapabilities: ["issue-analysis"],
        expectedWorkflow: ["inspect", "classify"],
      },
    ],
    fallbackRule: {
      id: "custom-quick",
      mode: ExecutionMode.QUICK,
      reasonCode: "quick-path",
      reasonDescription: "Custom fallback.",
      priority: 0,
      keywords: [],
      phrases: [],
      confidence: 0.6,
      estimatedComplexity: 5,
      estimatedCost: 0,
      estimatedDuration: 1_000,
      requiredDomains: [],
      requiredCapabilities: [],
      expectedWorkflow: ["respond"],
    },
  });
  const classifier = new PolicyBasedExecutionClassifier(policy);
  const decision = classifier.classify({
    message: "Realize a triagem deste relato.",
  });

  assert.equal(decision.mode, ExecutionMode.ANALYSIS);
  assert.equal(decision.confidence, 0.77);
  assert.deepEqual(decision.requiredDomains, ["support"]);
  assert.deepEqual(decision.requiredCapabilities, ["issue-analysis"]);
  assert.deepEqual(decision.expectedWorkflow, ["inspect", "classify"]);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.rules), true);
  assert.equal(Object.isFrozen(policy.rules[0]), true);
});

test("validates messages, estimates and policy invariants", () => {
  const classifier = new PolicyBasedExecutionClassifier();
  assert.throws(
    () => classifier.classify({ message: "   " }),
    /must not be empty/,
  );
  assert.throws(
    () =>
      createExecutionDecision({
        mode: ExecutionMode.QUICK,
        confidence: 1.1,
        reason: {
          code: "quick-path",
          description: "Invalid confidence.",
          matchedSignals: [],
          policyRuleId: "quick",
        },
        estimatedComplexity: 1,
        estimatedCost: 0,
        estimatedDuration: 1,
        requiredDomains: [],
        requiredCapabilities: [],
        expectedWorkflow: ["respond"],
      }),
    /confidence.*between 0 and 1/,
  );
  assert.throws(
    () =>
      defineExecutionPolicy({
        id: "duplicate-rules",
        version: "1.0.0",
        rules: [
          {
            id: "duplicate",
            mode: ExecutionMode.ANALYSIS,
            reasonCode: "policy-rule",
            reasonDescription: "Duplicate.",
            priority: 1,
            keywords: ["test"],
            phrases: [],
            confidence: 1,
            estimatedComplexity: 1,
            estimatedCost: 0,
            estimatedDuration: 1,
            requiredDomains: [],
            requiredCapabilities: [],
            expectedWorkflow: ["analyze"],
          },
        ],
        fallbackRule: {
          id: "duplicate",
          mode: ExecutionMode.QUICK,
          reasonCode: "quick-path",
          reasonDescription: "Fallback.",
          priority: 0,
          keywords: [],
          phrases: [],
          confidence: 1,
          estimatedComplexity: 1,
          estimatedCost: 0,
          estimatedDuration: 1,
          requiredDomains: [],
          requiredCapabilities: [],
          expectedWorkflow: ["respond"],
        },
      }),
    /rule ids must be unique/,
  );
});

test("classifier has no tool, agent, provider or existing-flow integration", () => {
  const classifierSource = readFileSync(
    new URL(
      "../services/agents/classification/execution-classifier.ts",
      import.meta.url,
    ),
    "utf8",
  );
  for (const forbidden of [
    "ToolExecutionService",
    "MessageBus",
    "ChiefAgent",
    "Scheduler",
    "BaseAgent",
    "FlowAgent",
    "provider",
  ]) {
    assert.doesNotMatch(classifierSource, new RegExp(forbidden, "i"));
  }

  const currentFlowSources = [
    "../lib/ai/gemini.ts",
    "../services/agents/chief/chief-agent.ts",
  ].map((path) =>
    readFileSync(new URL(path, import.meta.url), "utf8")
  );
  for (const source of currentFlowSources) {
    assert.doesNotMatch(source, /ExecutionClassifier/);
    assert.doesNotMatch(source, /PolicyBasedExecutionClassifier/);
  }
});
