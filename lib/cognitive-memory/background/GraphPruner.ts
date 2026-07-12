import type { IStorageProvider } from '../storage/IStorageProvider';
import { JsonStorageProvider } from '../storage/JsonStorageProvider';

export class GraphPruner {
  private storage: IStorageProvider = new JsonStorageProvider();

  public async decaySemanticGraph(avatarId: string): Promise<void> {
    const data = await this.storage.readMemory();
    const lambda = 0.01; // Taxa de decaimento por tempo decorrido
    
    // Aplica decaimento nas arestas (edges)
    data.semantic.edges = data.semantic.edges.map((edge) => {
      const msSinceLast = Date.now() - Date.parse(edge.lastReinforced);
      const daysSince = msSinceLast / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-lambda * daysSince);
      const newWeight = edge.weight * decayFactor;

      return {
        ...edge,
        weight: newWeight
      };
    });

    // Remove arestas com peso muito baixo (menor que 0.15)
    data.semantic.edges = data.semantic.edges.filter((e) => e.weight >= 0.15);

    // Remove nós do tipo 'error-pattern' órfãos
    const connectedNodeIds = new Set<string>();
    for (const edge of data.semantic.edges) {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }

    data.semantic.nodes = data.semantic.nodes.filter(
      (node) => node.type === 'entity' || connectedNodeIds.has(node.id)
    );

    await this.storage.writeMemory(data);
  }

  public async compressEpisodicMemory(avatarId: string, maxEpisodes = 100): Promise<void> {
    const data = await this.storage.readMemory();
    const avatarEpisodes = data.episodic.nodes.filter((n) => n.avatarId === avatarId);

    if (avatarEpisodes.length <= maxEpisodes) return;

    // Ordena por data decrescente (mais recente primeiro)
    const sorted = avatarEpisodes.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const kept = sorted.slice(0, maxEpisodes);
    const discarded = sorted.slice(maxEpisodes);

    const otherEpisodes = data.episodic.nodes.filter((n) => n.avatarId !== avatarId);
    data.episodic.nodes = [...otherEpisodes, ...kept];

    await this.storage.writeMemory(data);
    console.info(`[GraphPruner] Higienização de episódios do avatar ${avatarId} completa. Arquivados ${discarded.length} episódios.`);
  }
}
export const graphPruner = new GraphPruner();
