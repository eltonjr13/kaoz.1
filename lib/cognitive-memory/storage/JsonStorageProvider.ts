import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IStorageProvider, CognitiveMemoryData } from './IStorageProvider';

export class JsonStorageProvider implements IStorageProvider {
  private filePath: string;

  constructor() {
    this.filePath = path.join(process.cwd(), 'storage', 'cognitive-memory.json');
  }

  public async readMemory(): Promise<CognitiveMemoryData> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const data = JSON.parse(content) as CognitiveMemoryData;
      
      return {
        episodic: {
          nodes: data.episodic?.nodes || []
        },
        procedural: {
          rules: data.procedural?.rules || []
        },
        semantic: {
          nodes: data.semantic?.nodes || [],
          edges: data.semantic?.edges || []
        },
        chat: {
          memories: data.chat?.memories || []
        }
      };
    } catch {
      return {
        episodic: {
          nodes: []
        },
        procedural: {
          rules: []
        },
        semantic: {
          nodes: [],
          edges: []
        },
        chat: {
          memories: []
        }
      };
    }
  }

  public async writeMemory(data: CognitiveMemoryData): Promise<void> {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error('[JsonStorageProvider] Failed to write memory file:', error);
      throw error;
    }
  }
}
