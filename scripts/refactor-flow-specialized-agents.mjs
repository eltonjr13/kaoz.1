import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourcePath = path.join(root, "src/providers/flow/FlowAgent.ts");
const sourceText = await readFile(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const flowClass = sourceFile.statements.find(
  (statement) =>
    ts.isClassDeclaration(statement) &&
    statement.name?.text === "FlowAgent",
);
if (!flowClass) {
  throw new Error("FlowAgent class was not found.");
}

const methods = new Map(
  flowClass.members
    .filter(
      (member) =>
        ts.isMethodDeclaration(member) &&
        ts.isIdentifier(member.name),
    )
    .map((member) => [
      member.name.text,
      sourceText
        .slice(member.getFullStart(), member.end)
        .trim()
        .replace(/^private /m, "private "),
    ]),
);

function extract(names) {
  return names
    .map((name) => {
      const method = methods.get(name);
      if (!method) throw new Error(`Method ${name} was not found.`);
      return method;
    })
    .join("\n\n  ");
}

const projectMethods = extract([
  "generateBackgroundVideoPrompt",
  "generateBackgroundVideo",
  "updateJobVideoPath",
  "finalizeJob",
  "createCompleteProject",
]);
const imageMethods = extract([
  "getTurnaroundViews",
  "buildPrimaryTurnaroundPrompt",
  "buildSingleTurnaroundPrompt",
  "executeTurnaroundImageFlow",
  "getQuantityCount",
  "stripScaleCountFromImagePrompt",
  "buildScaleImagePrompt",
  "updateImageJobProgress",
  "executeImageFlow",
]);
const videoMethods = extract(["executeVideoFlow"]);
const refineMethods = extract(["executeRefineFlow"]);
const creativeMethods = extract([
  "logCreativePlan",
  "executeAdCreativeFlow",
  "planAutonomousAgent",
]);

await writeFile(
  path.join(root, "src/providers/flow/agents/ProjectAgent.ts"),
  `import { getMemoryContextForPrompt } from "@/lib/agent-memory";
import { updateLocalJob } from "@/lib/local-store";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class ProjectAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-project-agent"),
        name: "Project Agent",
        kind: "flow-project",
        capabilities: ["flow-project"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "project");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.createCompleteProject({
        ...prepared.options,
        topic: input.decision.optimizedPrompt || input.options.topic,
      });
    } finally {
      await prepared.cleanup();
    }
  }

  ${projectMethods}
}
`,
);

await writeFile(
  path.join(root, "src/providers/flow/agents/ImageAgent.ts"),
  `import { updateLocalJob } from "@/lib/local-store";
import { getFlowGeneratedDir } from "@/lib/runtime-paths";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import {
  resolveTurnaroundReferencePolicy,
} from "../ImageGenerationContract";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  BASE_TURNAROUND_VIEWS,
  TOP_BOTTOM_VIEWS,
  TURNAROUND_VIEW_INSTRUCTIONS,
  TURNAROUND_VIEW_LABELS,
  type AgentTaskOptions,
  type FlowExecutionResult,
  type GenerationQuantity,
  type TurnaroundView,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class ImageAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-image-agent"),
        name: "Image Agent",
        kind: "flow-image",
        capabilities: ["flow-image"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "image");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeImageFlow(
        prepared.options,
        input.decision.optimizedPrompt,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  ${imageMethods}
}
`,
);

await writeFile(
  path.join(root, "src/providers/flow/agents/VideoAgent.ts"),
  `import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  type AgentTaskOptions,
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class VideoAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-video-agent"),
        name: "Video Agent",
        kind: "flow-video",
        capabilities: ["flow-video"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "video");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeVideoFlow(
        prepared.options,
        input.decision.optimizedPrompt,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  ${videoMethods}
}
`,
);

await writeFile(
  path.join(root, "src/providers/flow/agents/RefineAgent.ts"),
  `import { GoogleGenAI } from "@google/genai";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  type AgentTaskOptions,
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class RefineAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-refine-agent"),
        name: "Refine Agent",
        kind: "flow-refine",
        capabilities: ["flow-refine"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "refine");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeRefineFlow(
        prepared.options,
        input.decision.targetJobId || "latest",
        input.decision.optimizedPrompt,
        prepared.personality,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  ${refineMethods}
}
`,
);

await writeFile(
  path.join(root, "src/providers/flow/agents/CreativeAgent.ts"),
  `import {
  classifyIntention,
  type FlowDecision,
} from "@/lib/ai/gemini";
import { updateLocalJob } from "@/lib/local-store";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  MAX_IMAGE_BATCH_SIZE,
  MAX_SCALE_IMAGE_COUNT,
  type AgentTaskOptions,
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class CreativeAgent extends FlowSpecializedAgentBase<
  FlowExecutionResult | FlowDecision
> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-creative-agent"),
        name: "Creative Agent",
        kind: "flow-creative",
        capabilities: ["flow-planning", "flow-creative"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult | FlowDecision> {
    this.assertReadyForFlowTask();
    const kind = (task.input as { kind?: string } | undefined)?.kind;
    if (kind === "planning") {
      const input = requireFlowTaskInput(task, "planning");
      return this.planAutonomousAgent({ topic: input.topic });
    }
    if (kind === "prepare") {
      const input = requireFlowTaskInput(task, "prepare");
      const decision = input.options.approvedPlan
        ? input.options.approvedPlan
        : await this.planAutonomousAgent({ topic: input.options.topic });
      if (input.options.approvedPlan) {
        await this.logAgentEvent(
          input.options.jobId,
          "planning",
          "Plano aprovado pelo usuario. Iniciando execucao autorizada.",
        );
      }
      await this.logAgentEvent(
        input.options.jobId,
        "planning",
        \`Classificação concluída. Decisão: fluxo "\${decision.flow}". Explicação: \${decision.explanation}\`,
      );
      await this.logCreativePlan(input.options.jobId, decision);
      return decision;
    }

    const input = requireFlowTaskInput(task, "creative");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeAdCreativeFlow(
        prepared.options,
        input.decision,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  ${creativeMethods}
}
`,
);

console.log("Specialized Flow agent files generated.");
