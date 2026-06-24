import type { IStorageProvider } from '../storage/IStorageProvider';
import type { ProceduralRule } from '../types/memory';

export class ProceduralMemory {
  constructor(private storage: IStorageProvider) {}

  public async addRule(rule: ProceduralRule): Promise<void> {
    const data = await this.storage.readMemory();
    const existingIndex = data.procedural.rules.findIndex((r) => r.id === rule.id);

    if (existingIndex >= 0) {
      data.procedural.rules[existingIndex] = {
        ...data.procedural.rules[existingIndex],
        ...rule,
        lastUpdated: new Date().toISOString()
      };
    } else {
      data.procedural.rules.push(rule);
    }

    await this.storage.writeMemory(data);
  }

  public async reinforceRule(ruleId: string, result: 'success' | 'failure'): Promise<void> {
    const data = await this.storage.readMemory();
    const rule = data.procedural.rules.find((r) => r.id === ruleId);
    if (!rule) return;

    if (result === 'success') {
      rule.successCount += 1;
      rule.confidenceScore = Math.min(1.0, rule.confidenceScore + 0.05);
    } else {
      rule.failureCount += 1;
      rule.confidenceScore = Math.max(0.0, rule.confidenceScore - 0.15);
    }

    rule.lastUpdated = new Date().toISOString();
    await this.storage.writeMemory(data);
  }
}
