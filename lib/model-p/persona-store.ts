import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getLocalDataDir } from '../runtime-paths';
import type { PersonaStyleProfile } from './types';

const STORE_FILENAME = 'model-p-personas.json';

interface PersonaStoreData {
  version: 1;
  personas: PersonaStyleProfile[];
}

export class PersonaStore {
  private static instance: PersonaStore | null = null;
  private memoryCache: PersonaStyleProfile[] | null = null;

  public static getInstance(): PersonaStore {
    if (!PersonaStore.instance) {
      PersonaStore.instance = new PersonaStore();
    }
    return PersonaStore.instance;
  }

  private getStoreFilePath(): string {
    return path.join(getLocalDataDir(), STORE_FILENAME);
  }

  private async load(): Promise<PersonaStyleProfile[]> {
    if (this.memoryCache !== null) return this.memoryCache;

    const filePath = this.getStoreFilePath();
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersonaStoreData>;
      this.memoryCache = Array.isArray(parsed.personas) ? parsed.personas : [];
    } catch {
      this.memoryCache = [];
    }
    return this.memoryCache;
  }

  private async persist(): Promise<void> {
    const filePath = this.getStoreFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const payload: PersonaStoreData = {
      version: 1,
      personas: this.memoryCache || [],
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  public async listPersonas(): Promise<PersonaStyleProfile[]> {
    const list = await this.load();
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async getPersonaById(id: string): Promise<PersonaStyleProfile | null> {
    const list = await this.load();
    return list.find((p) => p.id === id) || null;
  }

  public async savePersona(persona: PersonaStyleProfile): Promise<PersonaStyleProfile> {
    const list = await this.load();
    const index = list.findIndex((p) => p.id === persona.id);

    if (index >= 0) {
      list[index] = { ...persona, updatedAt: new Date().toISOString() };
    } else {
      list.push(persona);
    }

    this.memoryCache = list;
    await this.persist();
    return persona;
  }

  public async deletePersona(id: string): Promise<boolean> {
    const list = await this.load();
    const filtered = list.filter((p) => p.id !== id);
    if (filtered.length === list.length) return false;

    this.memoryCache = filtered;
    await this.persist();
    return true;
  }
}
