export type SystemHealthState = "healthy" | "warning" | "error" | "info";

export interface SystemHealthCheck {
  id: string;
  label: string;
  state: SystemHealthState;
  detail: string;
}

export interface SystemHealthReport {
  checkedAt: string;
  overall: Exclude<SystemHealthState, "info">;
  summary: string;
  groups: Array<{ id: string; label: string; checks: SystemHealthCheck[] }>;
}
