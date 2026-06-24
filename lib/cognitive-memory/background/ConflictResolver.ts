import type { IStorageProvider } from '../storage/IStorageProvider';
import { JsonStorageProvider } from '../storage/JsonStorageProvider';

export class ConflictResolver {
  private storage: IStorageProvider = new JsonStorageProvider();

  public async resolveSemanticConflicts(): Promise<void> {
    const data = await this.storage.readMemory();
    let updated = false;

    // Procura por arestas conflitantes no grafo
    // Ex: Node A -> Node B (Relação 'causes_failure') vs Node A -> Node B (Relação 'improves_quality')
    const edgeMap = new Map<string, typeof data.semantic.edges[0][]>();
    
    for (const edge of data.semantic.edges) {
      const key = `${edge.source}->${edge.target}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, []);
      }
      edgeMap.get(key)!.push(edge);
    }

    for (const [key, edges] of edgeMap.entries()) {
      if (edges.length > 1) {
        // Encontramos arestas paralelas para o mesmo par de nós (possível contradição)
        // Se uma diz 'causes_failure' e outra diz 'improves_quality', aplicamos penalidade à mais antiga/menor ocorrência
        const sortedByRecency = edges.sort((a, b) => Date.parse(b.lastReinforced) - Date.parse(a.lastReinforced));
        const winner = sortedByRecency[0];

        // Reduz drasticamente a relevância dos perdedores
        for (let i = 1; i < sortedByRecency.length; i++) {
          const loser = sortedByRecency[i];
          if (loser.relation !== winner.relation) {
            loser.weight = loser.weight * 0.2;
            loser.confidenceScore = loser.confidenceScore * 0.2;
            updated = true;
          }
        }
      }
    }

    if (updated) {
      // Remove arestas cujo peso ficou insignificante devido ao conflito
      data.semantic.edges = data.semantic.edges.filter((e) => e.weight >= 0.1);
      await this.storage.writeMemory(data);
      console.info("[ConflictResolver] Conflitos semânticos detectados e resolvidos com sucesso.");
    }
  }
}
export const conflictResolver = new ConflictResolver();
