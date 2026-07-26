import type { ExecutionDecision } from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import { BaseWorkflow } from "./base-workflow.ts";
import type { BaseWorkflowOptions } from "./workflow.types.ts";

export class StreamingWorkflow extends BaseWorkflow {
  constructor(
    decision: ExecutionDecision,
    options: BaseWorkflowOptions = {},
  ) {
    super("streaming-workflow", ExecutionMode.STREAMING, decision, options);
  }
}
