import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IStorageProvider, CognitiveMemoryData } from './IStorageProvider';
import { getFlowStorageRoot } from '../../runtime-paths.ts';

const DEFAULT_USER_ID = 'local-user';

function emptyMemory(): CognitiveMemoryData {
  return {
    episodic: { nodes: [] },
    procedural: { rules: [] },
    semantic: { nodes: [], edges: [] },
    chat: { memories: [] }
  };
}

function normalizeMemory(data: Partial<CognitiveMemoryData> | undefined): CognitiveMemoryData {
  return {
    episodic: { nodes: data?.episodic?.nodes || [] },
    procedural: { rules: data?.procedural?.rules || [] },
    semantic: {
      nodes: data?.semantic?.nodes || [],
      edges: data?.semantic?.edges || []
    },
    chat: {
      memories: (data?.chat?.memories || []).map((memory) => ({
        ...memory,
        userId: memory.userId || DEFAULT_USER_ID,
        explicit: memory.explicit ?? false,
        canonicalKey: memory.canonicalKey || `legacy:${memory.kind}:${normalizeKey(memory.content)}`,
        tags: memory.tags || []
      }))
    }
  };
}

function normalizeKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export class JsonStorageProvider implements IStorageProvider {
  private static queues = new Map<string, Promise<unknown>>();
  private filePath: string;
  private legacyFilePath: string;
  private migrationPromise?: Promise<void>;

  constructor(filePath?: string, legacyFilePath?: string) {
    this.filePath = filePath || path.join(getFlowStorageRoot(), 'cognitive-memory.json');
    this.legacyFilePath = legacyFilePath || path.join(process.cwd(), 'storage', 'cognitive-memory.json');
  }

  public async readMemory(): Promise<CognitiveMemoryData> {
    await this.ensureMigrated();
    try {
      const content = await readFile(this.filePath, 'utf8');
      return normalizeMemory(JSON.parse(content) as CognitiveMemoryData);
    } catch {
      return emptyMemory();
    }
  }

  public async writeMemory(data: CognitiveMemoryData): Promise<void> {
    await this.enqueue(async () => this.writeAtomic(normalizeMemory(data)));
  }

  public async updateMemory<T>(mutator: (data: CognitiveMemoryData) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const data = await this.readMemoryUnlocked();
      const result = await mutator(data);
      await this.writeAtomic(data);
      return result;
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = JsonStorageProvider.queues.get(this.filePath) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    JsonStorageProvider.queues.set(this.filePath, current);
    try {
      return await current;
    } finally {
      if (JsonStorageProvider.queues.get(this.filePath) === current) {
        JsonStorageProvider.queues.delete(this.filePath);
      }
    }
  }

  private async readMemoryUnlocked(): Promise<CognitiveMemoryData> {
    await this.ensureMigrated();
    try {
      return normalizeMemory(JSON.parse(await readFile(this.filePath, 'utf8')) as CognitiveMemoryData);
    } catch {
      return emptyMemory();
    }
  }

  private async writeAtomic(data: CognitiveMemoryData): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      console.error('[JsonStorageProvider] Failed to write memory file:', error);
      throw error;
    }
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = (async () => {
        if (path.resolve(this.filePath) === path.resolve(this.legacyFilePath)) return;
        try {
          await stat(this.filePath);
          return;
        } catch {}
        try {
          await stat(this.legacyFilePath);
          await mkdir(path.dirname(this.filePath), { recursive: true });
          await copyFile(this.legacyFilePath, this.filePath);
        } catch {
          // No legacy memory exists; the destination is created on first write.
        }
      })();
    }
    await this.migrationPromise;
  }
}
