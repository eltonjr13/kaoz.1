import {
  createExecutionDecision,
  type ExecutionDecision,
} from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import { AnalysisWorkflow } from "./analysis-workflow.ts";
import { BackgroundWorkflow } from "./background-workflow.ts";
import { BaseWorkflow } from "./base-workflow.ts";
import { ExecutionWorkflow } from "./execution-workflow.ts";
import type { ExecutionWorkflowOptions } from "./execution-workflow.types.ts";
import { QuickWorkflow } from "./quick-workflow.ts";
import { StreamingWorkflow } from "./streaming-workflow.ts";
import type { BaseWorkflowOptions } from "./workflow.types.ts";

export interface WorkflowFactoryOptions extends BaseWorkflowOptions {
  readonly execution?: Pick<
    ExecutionWorkflowOptions,
    "runtime" | "blackboard" | "messageBus"
  >;
}

export class WorkflowFactory {
  private readonly options: WorkflowFactoryOptions;

  constructor(options: WorkflowFactoryOptions = {}) {
    this.options = Object.freeze({ ...options });
  }

  create(decisionInput: ExecutionDecision): BaseWorkflow {
    const decision = createExecutionDecision(decisionInput);
    const { execution, ...baseOptions } = this.options;
    switch (decision.mode) {
      case ExecutionMode.QUICK:
        return new QuickWorkflow(decision, baseOptions);
      case ExecutionMode.ANALYSIS:
        return new AnalysisWorkflow(decision, baseOptions);
      case ExecutionMode.EXECUTION:
        return new ExecutionWorkflow(decision, {
          ...baseOptions,
          ...execution,
        });
      case ExecutionMode.BACKGROUND:
        return new BackgroundWorkflow(decision, baseOptions);
      case ExecutionMode.STREAMING:
        return new StreamingWorkflow(decision, baseOptions);
      default:
        return assertNever(decision.mode);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported ExecutionMode "${String(value)}".`);
}
