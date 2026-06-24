import type { IStorageProvider } from '../storage/IStorageProvider';
import type { GraphNode, GraphEdge, SemanticGraph } from '../types/graph';

export class SemanticMemory {
  constructor(private storage: IStorageProvider) {}

  public async upsertNode(node: GraphNode): Promise<void> {
    const data = await this.storage.readMemory();
    const existingIndex = data.semantic.nodes.findIndex((n) => n.id === node.id);

    if (existingIndex >= 0) {
      data.semantic.nodes[existingIndex] = {
        ...data.semantic.nodes[existingIndex],
        ...node,
        lastObserved: new Date().toISOString()
      };
    } else {
      data.semantic.nodes.push(node);
    }

    await this.storage.writeMemory(data);
  }

  public async upsertEdge(edge: GraphEdge): Promise<void> {
    const data = await this.storage.readMemory();
    const existingIndex = data.semantic.edges.findIndex((e) => e.id === edge.id);

    if (existingIndex >= 0) {
      const existing = data.semantic.edges[existingIndex];
      // Incrementa a força do relacionamento (peso) assintoticamente
      const alpha = 0.15; // Taxa de aprendizado
      const newWeight = Math.min(1.0, existing.weight + alpha * (1.0 - existing.weight));
      
      data.semantic.edges[existingIndex] = {
        ...existing,
        ...edge,
        weight: newWeight,
        occurrences: existing.occurrences + 1,
        lastReinforced: new Date().toISOString()
      };
    } else {
      data.semantic.edges.push(edge);
    }

    await this.storage.writeMemory(data);
  }

  public async getRelatedSubGraph(nodeIds: string[]): Promise<SemanticGraph> {
    const data = await this.storage.readMemory();
    const nodeIdSet = new Set(nodeIds);

    const edges = data.semantic.edges.filter(
      (e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target)
    );

    const relatedNodeIds = new Set<string>();
    for (const edge of edges) {
      relatedNodeIds.add(edge.source);
      relatedNodeIds.add(edge.target);
    }
    // Adiciona os originais de volta
    nodeIds.forEach((id) => relatedNodeIds.add(id));

    const nodes = data.semantic.nodes.filter((n) => relatedNodeIds.has(n.id));

    return { nodes, edges };
  }
}
