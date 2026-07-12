import type { EpisodicMemoryNode, ProceduralRule, ChatMemoryStore } from '../types/memory';
import type { SemanticGraph } from '../types/graph';

export interface CognitiveMemoryData {
  episodic: {
    nodes: EpisodicMemoryNode[];
  };
  procedural: {
    rules: ProceduralRule[];
  };
  semantic: SemanticGraph;
  chat?: ChatMemoryStore;
}

export interface IStorageProvider {
  readMemory(): Promise<CognitiveMemoryData>;
  writeMemory(data: CognitiveMemoryData): Promise<void>;
}
