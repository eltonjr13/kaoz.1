import { normalizeCapabilityName } from "../core/agent-capabilities.ts";
import { createDependencyGraph } from "./dependency-graph.ts";
import type {
  AcceptanceCriteria,
  Estimate,
  ExecutionPlan,
  ExecutionPlanDraft,
  ExecutionPlanMaterialization,
  ExecutionStep,
  ExecutionStepDraft,
  Goal,
  GoalInput,
  Milestone,
  MilestoneDraft,
  Risk,
} from "./planning.types.ts";

export function createAcceptanceCriteria(
  input: AcceptanceCriteria,
): AcceptanceCriteria {
  return Object.freeze({
    id: requireText(input.id, "Acceptance criteria id"),
    description: requireText(
      input.description,
      "Acceptance criteria description",
    ),
    verificationMethod: requireText(
      input.verificationMethod,
      "Acceptance criteria verificationMethod",
    ),
    required: input.required === true,
  });
}

export function createEstimate(input: Estimate): Estimate {
  assertNonNegative(input.effortPoints, "Estimate effortPoints");
  assertNonNegative(input.durationMs, "Estimate durationMs");
  assertNonNegative(input.cost, "Estimate cost");
  assertRange(input.confidence, 0, 1, "Estimate confidence");

  return Object.freeze({
    effortPoints: input.effortPoints,
    durationMs: input.durationMs,
    cost: input.cost,
    confidence: input.confidence,
  });
}

export function createRisk(input: Risk): Risk {
  assertRange(input.probability, 0, 1, "Risk probability");
  assertRange(input.impact, 1, 5, "Risk impact");
  const relatedStepIds = normalizeUniqueIds(
    input.relatedStepIds,
    `Risk "${input.id}" contains duplicate related steps.`,
  );

  return Object.freeze({
    id: requireText(input.id, "Risk id"),
    description: requireText(input.description, "Risk description"),
    probability: input.probability,
    impact: input.impact,
    mitigation: requireText(input.mitigation, "Risk mitigation"),
    relatedStepIds,
  });
}

export function createGoal(input: GoalInput): Goal {
  const acceptanceCriteria = (input.acceptanceCriteria ?? []).map(
    createAcceptanceCriteria,
  );
  assertUniqueIds(acceptanceCriteria, "Goal acceptance criteria");

  return Object.freeze({
    id: requireText(input.id, "Goal id"),
    title: requireText(input.title, "Goal title"),
    objective: requireText(input.objective, "Goal objective"),
    constraints: normalizeTexts(input.constraints ?? [], "Goal constraint"),
    acceptanceCriteria: Object.freeze(acceptanceCriteria),
    createdAt: normalizeTimestamp(
      input.createdAt ?? new Date().toISOString(),
      "Goal createdAt",
    ),
  });
}

export function createExecutionStep(input: ExecutionStepDraft): ExecutionStep {
  const id = requireText(input.id, "Execution step id");
  return Object.freeze({
    id,
    title: requireText(input.title, "Execution step title"),
    description: requireText(
      input.description,
      "Execution step description",
    ),
    capability: normalizeCapabilityName(input.capability),
    input: freezeStructuredValue(input.input),
    dependencyIds: normalizeUniqueIds(
      input.dependencyIds ?? [],
      `Execution step "${id}" contains duplicate dependencies.`,
    ),
    milestoneId: optionalText(input.milestoneId, "Execution step milestoneId"),
    acceptanceCriteriaIds: normalizeUniqueIds(
      input.acceptanceCriteriaIds ?? [],
      `Execution step "${id}" contains duplicate acceptance criteria.`,
    ),
    riskIds: normalizeUniqueIds(
      input.riskIds ?? [],
      `Execution step "${id}" contains duplicate risks.`,
    ),
    estimate: createEstimate(input.estimate),
  });
}

export function createExecutionPlan(
  goalInput: Goal,
  draft: ExecutionPlanDraft,
  materialization: ExecutionPlanMaterialization,
): ExecutionPlan {
  const goal = createGoal(goalInput);
  const generatedCriteria = (draft.acceptanceCriteria ?? []).map(
    createAcceptanceCriteria,
  );
  const acceptanceCriteria = [
    ...goal.acceptanceCriteria,
    ...generatedCriteria,
  ];
  assertUniqueIds(acceptanceCriteria, "Execution plan acceptance criteria");

  const risks = (draft.risks ?? []).map(createRisk);
  assertUniqueIds(risks, "Execution plan risks");

  const unorderedSteps = draft.steps.map(createExecutionStep);
  if (unorderedSteps.length === 0) {
    throw new Error("Execution plan must contain at least one step.");
  }
  assertUniqueIds(unorderedSteps, "Execution plan steps");

  const dependencyGraph = createDependencyGraph(unorderedSteps);
  const stepById = new Map(unorderedSteps.map((step) => [step.id, step]));
  const steps = dependencyGraph.topologicalOrder.map((id) => {
    const step = stepById.get(id);
    if (!step) {
      throw new Error(`Execution plan is missing step "${id}".`);
    }
    return step;
  });

  validateStepReferences(steps, acceptanceCriteria, risks);
  const milestones = (draft.milestones ?? []).map((milestone) =>
    createMilestone(milestone, steps, acceptanceCriteria),
  );
  assertUniqueIds(milestones, "Execution plan milestones");
  validateMilestoneAssignments(steps, milestones);

  return Object.freeze({
    id: requireText(materialization.id, "Execution plan id"),
    goal,
    title: requireText(draft.title, "Execution plan title"),
    summary: requireText(draft.summary, "Execution plan summary"),
    steps: Object.freeze(steps),
    dependencyGraph,
    milestones: Object.freeze(milestones),
    acceptanceCriteria: Object.freeze(acceptanceCriteria),
    risks: Object.freeze(risks),
    estimate: aggregateEstimates(steps.map((step) => step.estimate)),
    version: normalizeVersion(materialization.version ?? 1),
    createdAt: normalizeTimestamp(
      materialization.createdAt,
      "Execution plan createdAt",
    ),
  });
}

function createMilestone(
  input: MilestoneDraft,
  steps: readonly ExecutionStep[],
  acceptanceCriteria: readonly AcceptanceCriteria[],
): Milestone {
  const id = requireText(input.id, "Milestone id");
  const stepIds = normalizeUniqueIds(
    input.stepIds,
    `Milestone "${id}" contains duplicate steps.`,
  );
  if (stepIds.length === 0) {
    throw new Error(`Milestone "${id}" must contain at least one step.`);
  }
  const stepMap = new Map(steps.map((step) => [step.id, step]));
  assertKnownIds(stepIds, stepMap, `Milestone "${id}" references unknown step`);
  const acceptanceCriteriaIds = normalizeUniqueIds(
    input.acceptanceCriteriaIds ?? [],
    `Milestone "${id}" contains duplicate acceptance criteria.`,
  );
  assertKnownIds(
    acceptanceCriteriaIds,
    new Map(acceptanceCriteria.map((criteria) => [criteria.id, criteria])),
    `Milestone "${id}" references unknown acceptance criteria`,
  );

  return Object.freeze({
    id,
    title: requireText(input.title, "Milestone title"),
    description: requireText(input.description, "Milestone description"),
    stepIds,
    acceptanceCriteriaIds,
    estimate: aggregateEstimates(
      stepIds.map((stepId) => {
        const step = stepMap.get(stepId);
        if (!step) {
          throw new Error(`Milestone "${id}" references unknown step "${stepId}".`);
        }
        return step.estimate;
      }),
    ),
  });
}

function validateStepReferences(
  steps: readonly ExecutionStep[],
  acceptanceCriteria: readonly AcceptanceCriteria[],
  risks: readonly Risk[],
): void {
  const criteriaMap = new Map(
    acceptanceCriteria.map((criteria) => [criteria.id, criteria]),
  );
  const riskMap = new Map(risks.map((risk) => [risk.id, risk]));
  const stepMap = new Map(steps.map((step) => [step.id, step]));

  for (const step of steps) {
    assertKnownIds(
      step.acceptanceCriteriaIds,
      criteriaMap,
      `Execution step "${step.id}" references unknown acceptance criteria`,
    );
    assertKnownIds(
      step.riskIds,
      riskMap,
      `Execution step "${step.id}" references unknown risk`,
    );
  }
  for (const risk of risks) {
    assertKnownIds(
      risk.relatedStepIds,
      stepMap,
      `Risk "${risk.id}" references unknown step`,
    );
  }
}

function validateMilestoneAssignments(
  steps: readonly ExecutionStep[],
  milestones: readonly Milestone[],
): void {
  const milestoneMap = new Map(
    milestones.map((milestone) => [milestone.id, milestone]),
  );
  for (const step of steps) {
    if (step.milestoneId === undefined) {
      continue;
    }
    const milestone = milestoneMap.get(step.milestoneId);
    if (!milestone) {
      throw new Error(
        `Execution step "${step.id}" references unknown milestone "${step.milestoneId}".`,
      );
    }
    if (!milestone.stepIds.includes(step.id)) {
      throw new Error(
        `Milestone "${milestone.id}" does not include assigned step "${step.id}".`,
      );
    }
  }
}

function aggregateEstimates(estimates: readonly Estimate[]): Estimate {
  if (estimates.length === 0) {
    return createEstimate({
      effortPoints: 0,
      durationMs: 0,
      cost: 0,
      confidence: 0,
    });
  }
  return createEstimate({
    effortPoints: sum(estimates, (estimate) => estimate.effortPoints),
    durationMs: sum(estimates, (estimate) => estimate.durationMs),
    cost: sum(estimates, (estimate) => estimate.cost),
    confidence: Math.min(...estimates.map((estimate) => estimate.confidence)),
  });
}

function sum(
  values: readonly Estimate[],
  selector: (value: Estimate) => number,
): number {
  return values.reduce((total, value) => total + selector(value), 0);
}

function assertKnownIds<T>(
  ids: readonly string[],
  known: ReadonlyMap<string, T>,
  message: string,
): void {
  for (const id of ids) {
    if (!known.has(id)) {
      throw new Error(`${message} "${id}".`);
    }
  }
}

function assertUniqueIds(
  values: readonly { readonly id: string }[],
  label: string,
): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new Error(`${label} must have unique ids.`);
  }
}

function normalizeUniqueIds(
  values: readonly string[],
  duplicateMessage: string,
): readonly string[] {
  const normalized = values.map((value) => requireText(value, "Reference id"));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(duplicateMessage);
  }
  return Object.freeze([...normalized].sort((left, right) =>
    left.localeCompare(right)
  ));
}

function normalizeTexts(values: readonly string[], label: string): readonly string[] {
  return Object.freeze(values.map((value) => requireText(value, label)));
}

function optionalText(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : requireText(value, label);
}

function freezeStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeStructuredValue));
  }
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          freezeStructuredValue(entry),
        ]),
      ),
    );
  }
  return value;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function normalizeTimestamp(value: string, label: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeVersion(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Execution plan version must be a positive integer.");
  }
  return value;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function assertRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
}
