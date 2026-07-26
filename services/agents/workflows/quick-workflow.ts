import type { ExecutionDecision } from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import { BaseWorkflow } from "./base-workflow.ts";
import type { BaseWorkflowOptions } from "./workflow.types.ts";

export class QuickWorkflow extends BaseWorkflow {
  constructor(
    decision: ExecutionDecision,
    options: BaseWorkflowOptions = {},
  ) {
    super("quick-workflow", ExecutionMode.QUICK, decision, options);
  }
}
