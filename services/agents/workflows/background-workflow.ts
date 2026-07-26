import type { ExecutionDecision } from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import { BaseWorkflow } from "./base-workflow.ts";
import type { BaseWorkflowOptions } from "./workflow.types.ts";

export class BackgroundWorkflow extends BaseWorkflow {
  constructor(
    decision: ExecutionDecision,
    options: BaseWorkflowOptions = {},
  ) {
    super("background-workflow", ExecutionMode.BACKGROUND, decision, options);
  }
}
