export type NodeType = 'concept' | 'entity' | 'tool-outcome' | 'error-pattern';

export interface GraphNode {
  id: string;             // Ex: "concept:veo-aspect-ratio"
  label: string;          // Nome exibível
  type: NodeType;
  description: string;
  confidenceScore: number;// Score de validação do fato
  lastObserved: string;
  metadata: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;         // ID do Node origem
  target: string;         // ID do Node destino
  relation: string;       // Ex: "causes_failure", "improves_quality", "is_part_of"
  weight: number;         // Força do relacionamento (0.0 a 1.0)
  confidenceScore: number;// Validação estatística
  occurrences: number;    // Quantidade observada
  lastReinforced: string;
}

export interface SemanticGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
