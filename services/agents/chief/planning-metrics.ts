export interface PlannerMeasurement {
  readonly success: boolean;
  readonly durationMs: number;
  readonly planKind: string;
  readonly stepCount: number;
  readonly dependencyCount: number;
  readonly milestoneCount: number;
  readonly estimatedCost: number;
  readonly estimatedTime: number;
  readonly confidence: number;
  readonly error?: string;
}

export interface PlannerComparisonMetric {
  readonly id: string;
  readonly executionId: string;
  readonly goalId: string;
  readonly recordedAt: string;
  readonly selectedPlanner: "planner-agent" | "legacy-fallback";
  readonly fallbackUsed: boolean;
  readonly newPlanner: PlannerMeasurement;
  /**
   * The legacy baseline includes the complete compatibility-model call because
   * the old architecture does not separate planning from response generation.
   */
  readonly legacyBaseline: PlannerMeasurement;
  readonly comparison: {
    readonly stepCountDelta: number;
    readonly durationMsDelta: number;
    readonly structuredPlanAvailable: boolean;
  };
  readonly schedulerDecisionCount: number;
}

export interface LegacyPlanObservation {
  readonly planKind: string;
  readonly stepCount: number;
  readonly dependencyCount?: number;
  readonly milestoneCount?: number;
  readonly estimatedCost?: number;
  readonly estimatedTime?: number;
  readonly confidence?: number;
}

export interface LegacyPlanInspector<TResponse> {
  inspect(response: TResponse): LegacyPlanObservation;
}

export interface PlanningMetricsRecorder {
  record(metric: PlannerComparisonMetric): void | Promise<void>;
}

export interface PlanningMetricsSummary {
  readonly total: number;
  readonly plannerAgentSelected: number;
  readonly legacyFallbacks: number;
  readonly averageNewPlannerDurationMs: number;
  readonly averageLegacyBaselineDurationMs: number;
}

export class PlanningMetricsStore implements PlanningMetricsRecorder {
  private readonly metrics: PlannerComparisonMetric[] = [];
  private readonly capacity: number;

  constructor(capacity = 500) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Planning metrics capacity must be a positive integer.");
    }
    this.capacity = capacity;
  }

  record(metric: PlannerComparisonMetric): void {
    this.metrics.push(freezeMetric(metric));
    if (this.metrics.length > this.capacity) {
      this.metrics.splice(0, this.metrics.length - this.capacity);
    }
  }

  list(): readonly PlannerComparisonMetric[] {
    return Object.freeze([...this.metrics]);
  }

  summary(): PlanningMetricsSummary {
    const total = this.metrics.length;
    return Object.freeze({
      total,
      plannerAgentSelected: this.metrics.filter(
        (metric) => metric.selectedPlanner === "planner-agent",
      ).length,
      legacyFallbacks: this.metrics.filter((metric) => metric.fallbackUsed).length,
      averageNewPlannerDurationMs: average(
        this.metrics.map((metric) => metric.newPlanner.durationMs),
      ),
      averageLegacyBaselineDurationMs: average(
        this.metrics.map((metric) => metric.legacyBaseline.durationMs),
      ),
    });
  }

  clear(): void {
    this.metrics.length = 0;
  }
}

export const planningMetricsStore = new PlanningMetricsStore();

function freezeMetric(metric: PlannerComparisonMetric): PlannerComparisonMetric {
  return Object.freeze({
    ...metric,
    newPlanner: Object.freeze({ ...metric.newPlanner }),
    legacyBaseline: Object.freeze({ ...metric.legacyBaseline }),
    comparison: Object.freeze({ ...metric.comparison }),
  });
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return (
    Math.round(
      (values.reduce((total, value) => total + value, 0) / values.length) *
        1_000,
    ) / 1_000
  );
}
