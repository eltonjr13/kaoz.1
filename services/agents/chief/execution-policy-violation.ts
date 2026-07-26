import type { ExecutionDecision } from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import type { WorkflowResult, WorkflowStatus } from "../workflows/workflow.types.ts";
import type { ExecutionSession } from "./execution-session.ts";

export class ExecutionPolicyViolation extends Error {
  readonly executionId: string;
  readonly sessionId: string;

  constructor(
    executionId: string,
    sessionId: string,
    reason: string,
  ) {
    super(`Execution response policy violated: ${reason}`);
    this.name = "ExecutionPolicyViolation";
    this.executionId = executionId;
    this.sessionId = sessionId;
  }
}

export function assertExecutionResponseAllowed(input: {
  readonly decision: ExecutionDecision;
  readonly session: ExecutionSession;
  readonly workflowStatus: WorkflowStatus;
  readonly workflowResult?: WorkflowResult;
}): void {
  if (input.decision.mode !== ExecutionMode.EXECUTION) {
    return;
  }
  if (
    input.session.status !== "running" ||
    input.workflowStatus !== "completed" ||
    input.workflowResult?.status !== "completed" ||
    !Object.hasOwn(input.workflowResult, "output")
  ) {
    throw new ExecutionPolicyViolation(
      input.session.executionId,
      input.session.id,
      "EXECUTION objectives may respond only with the completed ExecutionWorkflow output.",
    );
  }
}
