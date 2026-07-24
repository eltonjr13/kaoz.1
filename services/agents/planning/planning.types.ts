export interface AcceptanceCriteria {
  readonly id: string;
  readonly description: string;
  readonly verificationMethod: string;
  readonly required: boolean;
}

export interface Estimate {
  readonly effortPoints: number;
  readonly durationMs: number;
  readonly cost: number;
  readonly confidence: number;
}

export interface Risk {
  readonly id: string;
  readonly description: string;
  readonly probability: number;
  readonly impact: number;
  readonly mitigation: string;
  readonly relatedStepIds: readonly string[];
}

export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly AcceptanceCriteria[];
  readonly createdAt: string;
}

export interface ExecutionStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly capability: string;
  readonly input?: unknown;
  readonly dependencyIds: readonly string[];
  readonly milestoneId?: string;
  readonly acceptanceCriteriaIds: readonly string[];
  readonly riskIds: readonly string[];
  readonly estimate: Estimate;
}

export interface DependencyEdge {
  readonly prerequisiteStepId: string;
  readonly dependentStepId: string;
}

export interface DependencyGraph {
  readonly nodes: readonly string[];
  readonly edges: readonly DependencyEdge[];
  readonly topologicalOrder: readonly string[];
}

export interface Milestone {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly stepIds: readonly string[];
  readonly acceptanceCriteriaIds: readonly string[];
  readonly estimate: Estimate;
}

export interface ExecutionPlan {
  readonly id: string;
  readonly goal: Goal;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly ExecutionStep[];
  readonly dependencyGraph: DependencyGraph;
  readonly milestones: readonly Milestone[];
  readonly acceptanceCriteria: readonly AcceptanceCriteria[];
  readonly risks: readonly Risk[];
  readonly estimate: Estimate;
  readonly version: number;
  readonly createdAt: string;
}

export interface GoalInput {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly constraints?: readonly string[];
  readonly acceptanceCriteria?: readonly AcceptanceCriteria[];
  readonly createdAt?: string;
}

export interface ExecutionStepDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly capability: string;
  readonly input?: unknown;
  readonly dependencyIds?: readonly string[];
  readonly milestoneId?: string;
  readonly acceptanceCriteriaIds?: readonly string[];
  readonly riskIds?: readonly string[];
  readonly estimate: Estimate;
}

export interface MilestoneDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly stepIds: readonly string[];
  readonly acceptanceCriteriaIds?: readonly string[];
}

export interface ExecutionPlanDraft {
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly ExecutionStepDraft[];
  readonly milestones?: readonly MilestoneDraft[];
  readonly acceptanceCriteria?: readonly AcceptanceCriteria[];
  readonly risks?: readonly Risk[];
}

export interface ExecutionPlanMaterialization {
  readonly id: string;
  readonly createdAt: string;
  readonly version?: number;
}
