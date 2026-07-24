import type {
  ExecutionSnapshot,
  SupervisionAction,
  SupervisionIssueType,
  SupervisionReport,
} from "./supervision.types.ts";

export type RecoveryStatus = "applied" | "failed" | "skipped";

export interface SupervisionRecoveryRecord {
  readonly id: string;
  readonly executionId: string;
  readonly action: SupervisionAction;
  readonly status: RecoveryStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly result?: unknown;
  readonly error?: string;
}

export interface SupervisionExecutionDashboard {
  readonly executionId: string;
  readonly updatedAt: string;
  readonly snapshot: ExecutionSnapshot;
  readonly reports: readonly SupervisionReport[];
  readonly recoveries: readonly SupervisionRecoveryRecord[];
}

export interface SupervisionDashboardSnapshot {
  readonly generatedAt: string;
  readonly summary: {
    readonly executions: number;
    readonly healthy: number;
    readonly unhealthy: number;
    readonly openIssues: number;
    readonly recoveriesApplied: number;
    readonly recoveriesFailed: number;
    readonly issuesByType: Readonly<Record<SupervisionIssueType, number>>;
  };
  readonly executions: readonly SupervisionExecutionDashboard[];
}

interface MutableExecutionDashboard {
  snapshot: ExecutionSnapshot;
  reports: SupervisionReport[];
  recoveries: SupervisionRecoveryRecord[];
  updatedAt: string;
}

export class SupervisionDashboardStore {
  private readonly executions = new Map<
    string,
    MutableExecutionDashboard
  >();

  recordSnapshot(snapshot: ExecutionSnapshot): void {
    const current = this.executions.get(snapshot.executionId);
    this.executions.set(snapshot.executionId, {
      snapshot,
      reports: current?.reports ?? [],
      recoveries: current?.recoveries ?? [],
      updatedAt: snapshot.capturedAt,
    });
    this.prune();
  }

  recordReport(report: SupervisionReport): void {
    const current = this.executions.get(report.executionId);
    if (!current) {
      return;
    }
    current.reports.push(report);
    current.reports = current.reports.slice(-100);
    current.updatedAt = report.analyzedAt;
  }

  recordRecovery(record: SupervisionRecoveryRecord): void {
    const current = this.executions.get(record.executionId);
    if (!current) {
      return;
    }
    current.recoveries.push(deepFreeze({ ...record }));
    current.recoveries = current.recoveries.slice(-100);
    current.updatedAt = record.completedAt;
  }

  snapshot(): SupervisionDashboardSnapshot {
    const executions = [...this.executions.entries()]
      .sort(
        ([, left], [, right]) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .map(([executionId, value]) =>
        Object.freeze({
          executionId,
          updatedAt: value.updatedAt,
          snapshot: value.snapshot,
          reports: Object.freeze([...value.reports]),
          recoveries: Object.freeze([...value.recoveries]),
        })
      );
    const latestReports = executions.flatMap(
      (execution) => execution.reports.at(-1) ?? [],
    );
    const issues = latestReports.flatMap((report) => report.issues);
    const recoveries = executions.flatMap((execution) => execution.recoveries);
    const issuesByType = Object.fromEntries(
      [
        "failure",
        "deadlock",
        "timeout",
        "loop",
        "inactive-agent",
        "stuck-task",
        "duplicate",
        "infinite-retry",
      ].map((type) => [
        type,
        issues.filter((issue) => issue.type === type).length,
      ]),
    ) as Record<SupervisionIssueType, number>;

    return Object.freeze({
      generatedAt: new Date().toISOString(),
      summary: Object.freeze({
        executions: executions.length,
        healthy: latestReports.filter((report) => report.healthy).length,
        unhealthy: latestReports.filter((report) => !report.healthy).length,
        openIssues: issues.length,
        recoveriesApplied: recoveries.filter(
          (record) => record.status === "applied",
        ).length,
        recoveriesFailed: recoveries.filter(
          (record) => record.status === "failed",
        ).length,
        issuesByType: Object.freeze(issuesByType),
      }),
      executions: Object.freeze(executions),
    });
  }

  clear(): void {
    this.executions.clear();
  }

  private prune(): void {
    if (this.executions.size <= 50) {
      return;
    }
    const oldest = [...this.executions.entries()].sort(
      ([, left], [, right]) =>
        Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
    )[0];
    if (oldest) {
      this.executions.delete(oldest[0]);
    }
  }
}

const dashboardGlobal = globalThis as typeof globalThis & {
  __kaozSupervisionDashboardStore?: SupervisionDashboardStore;
};
const dashboardStore =
  dashboardGlobal.__kaozSupervisionDashboardStore ??
  new SupervisionDashboardStore();
dashboardGlobal.__kaozSupervisionDashboardStore = dashboardStore;

export function getSupervisionDashboardStore(): SupervisionDashboardStore {
  return dashboardStore;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }
  return value;
}
