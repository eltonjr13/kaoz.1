import {
  createExecutionDecision,
  type ExecutionDecision,
} from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import { AnalysisWorkflow } from "./analysis-workflow.ts";
import { BackgroundWorkflow } from "./background-workflow.ts";
import { BaseWorkflow } from "./base-workflow.ts";
import { ExecutionWorkflow } from "./execution-workflow.ts";
import { QuickWorkflow } from "./quick-workflow.ts";
import { StreamingWorkflow } from "./streaming-workflow.ts";
import type { BaseWorkflowOptions } from "./workflow.types.ts";

export type WorkflowFactoryOptions = BaseWorkflowOptions;

export class WorkflowFactory {
  private readonly options: WorkflowFactoryOptions;

  constructor(options: WorkflowFactoryOptions = {}) {
    this.options = Object.freeze({ ...options });
  }

  create(decisionInput: ExecutionDecision): BaseWorkflow {
    const decision = createExecutionDecision(decisionInput);
    switch (decision.mode) {
      case ExecutionMode.QUICK:
        return new QuickWorkflow(decision, this.options);
      case ExecutionMode.ANALYSIS:
        return new AnalysisWorkflow(decision, this.options);
      case ExecutionMode.EXECUTION:
        return new ExecutionWorkflow(decision, this.options);
      case ExecutionMode.BACKGROUND:
        return new BackgroundWorkflow(decision, this.options);
      case ExecutionMode.STREAMING:
        return new StreamingWorkflow(decision, this.options);
      default:
        return assertNever(decision.mode);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported ExecutionMode "${String(value)}".`);
}
