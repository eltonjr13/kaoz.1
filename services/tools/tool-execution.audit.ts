import type {
  ToolExecutionAuditRecord,
  ToolExecutionAuditRecorder,
  ToolExecutionAuditStatistics,
} from "./tool-execution.types.ts";

const DEFAULT_AUDIT_LIMIT = 10_000;

export class InMemoryToolExecutionAudit
  implements ToolExecutionAuditRecorder
{
  private readonly records: ToolExecutionAuditRecord[] = [];
  private readonly limit: number;

  constructor(limit = DEFAULT_AUDIT_LIMIT) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Tool execution audit limit must be a positive integer.");
    }
    this.limit = limit;
  }

  record(record: ToolExecutionAuditRecord): void {
    this.records.push(freezeAuditRecord(record));
    if (this.records.length > this.limit) {
      this.records.splice(0, this.records.length - this.limit);
    }
  }

  list(): readonly ToolExecutionAuditRecord[] {
    return Object.freeze([...this.records]);
  }

  clear(): readonly ToolExecutionAuditRecord[] {
    const removed = Object.freeze([...this.records]);
    this.records.length = 0;
    return removed;
  }

  statistics(): ToolExecutionAuditStatistics {
    return Object.freeze({
      total: this.records.length,
      succeeded: count(this.records, (record) => record.success),
      failed: count(this.records, (record) => !record.success),
      denied: count(
        this.records,
        (record) => record.permissionDecision === "denied",
      ),
      totalDurationMs: sum(this.records, (record) => record.durationMs),
      totalCostUsd: sum(this.records, (record) => record.cost.amount),
      totalArgumentBytes: sum(
        this.records,
        (record) => record.consumption.argumentBytes,
      ),
      totalOutputBytes: sum(
        this.records,
        (record) => record.consumption.outputBytes,
      ),
      byAgent: countBy(this.records, (record) => String(record.agentId)),
      byTool: countBy(this.records, (record) => record.toolId),
    });
  }
}

function freezeAuditRecord(
  record: ToolExecutionAuditRecord,
): ToolExecutionAuditRecord {
  return Object.freeze({
    ...record,
    argumentNames: Object.freeze([...record.argumentNames]),
    cost: Object.freeze({ ...record.cost }),
    consumption: Object.freeze({ ...record.consumption }),
  });
}

function count<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): number {
  return values.filter(predicate).length;
}

function sum<T>(
  values: readonly T[],
  selector: (value: T) => number,
): number {
  return values.reduce((total, value) => total + selector(value), 0);
}

function countBy<T>(
  values: readonly T[],
  selector: (value: T) => string,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = selector(value);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.freeze(result);
}

