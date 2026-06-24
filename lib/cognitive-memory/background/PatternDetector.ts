import type { IStorageProvider } from '../storage/IStorageProvider';
import { JsonStorageProvider } from '../storage/JsonStorageProvider';
import type { ProceduralRule } from '../types/memory';

export class PatternDetector {
  private storage: IStorageProvider = new JsonStorageProvider();

  public async detectFailurePatterns(avatarId: string): Promise<void> {
    const data = await this.storage.readMemory();
    const failures = data.episodic.nodes.filter(
      (n) => n.avatarId === avatarId && n.status === 'failure'
    );

    if (failures.length < 3) return;

    // Se houver mais de 3 falhas de timeout em seletores Playwright
    const timeoutFailures = failures.filter(
      (n) => n.errorMessage && /timeout|download|waitFor/i.test(n.errorMessage)
    );

    if (timeoutFailures.length >= 3) {
      const ruleId = `rule:mitigate-playwright-timeout`;
      const exists = data.procedural.rules.some((r) => r.id === ruleId);

      if (!exists) {
        const newRule: ProceduralRule = {
          id: ruleId,
          avatarId: 'global',
          scope: 'general',
          triggerPattern: 'timeout',
          actionType: 'modify_prompt',
          instruction: 'Evitar sobrecarregar o renderizador do navegador. Introduzir espaçamento entre execuções de mídia.',
          confidenceScore: 0.8,
          successCount: 0,
          failureCount: 0,
          lastUpdated: new Date().toISOString(),
          timestamp: new Date().toISOString()
        };
        data.procedural.rules.push(newRule);
        await this.storage.writeMemory(data);
        console.info("[PatternDetector] Padrão de timeout recorrente detectado. Nova regra de prompt de infraestrutura cadastrada.");
      }
    }
  }
}
export const patternDetector = new PatternDetector();
