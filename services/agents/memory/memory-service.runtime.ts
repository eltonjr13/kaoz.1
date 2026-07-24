import { MemoryManagerAdapter } from "./memory-manager.adapter.ts";
import { MemoryService } from "./memory-service.ts";

export const memoryService = new MemoryService({
  backend: new MemoryManagerAdapter(),
});

