import type {
  ExecutionSnapshot,
  SupervisionActionDraft,
  SupervisionActionPlanner,
  SupervisionIssue,
  SupervisionPolicy,
} from "./supervision.types.ts";

export class DefaultSupervisionActionPlanner
  implements SupervisionActionPlanner {
  plan(
    issue: SupervisionIssue,
    _snapshot: ExecutionSnapshot,
    policy: SupervisionPolicy,
  ): readonly SupervisionActionDraft[] {
    const actions: SupervisionActionDraft[] = [];

    if (issue.type === "failure" || issue.type === "inactive-agent") {
      for (const agentId of issue.agentIds) {
        actions.push({
          type: "restart-agent",
          agentId,
          priority: issue.severity === "critical" ? 100 : 90,
          reason: issue.message,
        });
      }
    }
    if (
      issue.type === "failure" ||
      issue.type === "timeout" ||
      issue.type === "inactive-agent" ||
      issue.type === "stuck-task"
    ) {
      for (const taskId of issue.taskIds) {
        actions.push({
          type: "reassign-task",
          taskId,
          priority: issue.type === "timeout" ? 90 : 80,
          reason: issue.message,
        });
      }
    }
    if (issue.type === "deadlock" || issue.type === "loop") {
      actions.push({
        type: "reanalyze-plan",
        priority: 95,
        reason: issue.message,
      });
    }
    if (issue.type === "duplicate") {
      for (const taskId of issue.taskIds) {
        actions.push({
          type: "reassign-task",
          taskId,
          priority: 85,
          reason: issue.message,
        });
      }
      actions.push({
        type: "reanalyze-plan",
        priority: 90,
        reason: issue.message,
      });
    }
    if (issue.type === "infinite-retry") {
      actions.push({
        type: "reanalyze-plan",
        priority: 100,
        reason: issue.message,
      });
      actions.push({
        type: "cancel-execution",
        priority: 100,
        reason: issue.message,
      });
    }
    if (
      (issue.type === "deadlock" && policy.cancelOnDeadlock) ||
      (issue.type === "loop" && policy.cancelOnLoop)
    ) {
      actions.push({
        type: "cancel-execution",
        priority: 100,
        reason: issue.message,
      });
    }

    return Object.freeze(actions.map((action) => Object.freeze(action)));
  }
}
