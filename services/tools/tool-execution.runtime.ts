import { toolRegistry } from "./tool.registry.ts";
import { ToolExecutionService } from "./tool-execution.service.ts";

export const toolExecutionService = new ToolExecutionService({
  catalog: toolRegistry,
});
