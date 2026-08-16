import type { SystemHealthCheck, SystemHealthState } from "./system-health.types";

export function overallFromChecks(checks: SystemHealthCheck[]): Exclude<SystemHealthState, "info"> {
  if (checks.some((check) => check.state === "error")) return "error";
  if (checks.some((check) => check.state === "warning")) return "warning";
  return "healthy";
}

export function overallSummary(overall: Exclude<SystemHealthState, "info">): string {
  if (overall === "healthy") return "Ambiente pronto para uso.";
  if (overall === "warning") return "Ambiente utilizável, com itens que merecem atenção.";
  return "Há componentes necessários que precisam de atenção.";
}
