import type { CognitiveMemoryData } from '../storage/IStorageProvider';
import type { TaskType } from '../types/memory';

export class HierarchicalResolver {
  public resolvePromptInstructions(
    data: CognitiveMemoryData,
    avatarId: string,
    topic: string,
    taskType: TaskType,
    context: { projectId?: string; sessionId?: string } = {}
  ): string[] {
    const { projectId, sessionId } = context;

    // 1. Coleta regras procedimentais nos níveis hierárquicos
    const rules = data.procedural.rules;
    const resolvedRules: string[] = [];

    // Filtra regras ativas (confidenceScore >= 0.3)
    const activeRules = rules.filter((r) => r.confidenceScore >= 0.3);

    // Nível 1: Session
    if (sessionId) {
      const sessionRules = activeRules.filter(
        (r) => r.sessionId === sessionId && r.avatarId === avatarId
      );
      resolvedRules.push(...sessionRules.map((r) => r.instruction));
    }

    // Nível 2: Project
    if (projectId) {
      const projectRules = activeRules.filter(
        (r) => r.projectId === projectId && r.avatarId === avatarId && !r.sessionId
      );
      resolvedRules.push(...projectRules.map((r) => r.instruction));
    }

    // Nível 3: Avatar
    const avatarRules = activeRules.filter(
      (r) => r.avatarId === avatarId && !r.projectId && !r.sessionId
    );
    resolvedRules.push(...avatarRules.map((r) => r.instruction));

    // Nível 4: Global
    const globalRules = activeRules.filter(
      (r) => (r.avatarId === 'global' || r.avatarId === 'all') && !r.projectId && !r.sessionId
    );
    resolvedRules.push(...globalRules.map((r) => r.instruction));

    // 2. Coleta relacionamentos semânticos (erros/sucessos) relacionados ao tema ou modelo do grafo
    // Fazemos um matching simples por palavra-chave para recuperar conceitos
    const searchTopic = topic.toLowerCase().trim();
    const relatedNodes = data.semantic.nodes.filter(
      (n) =>
        searchTopic.includes(n.label.toLowerCase()) ||
        n.label.toLowerCase().includes(searchTopic) ||
        (n.metadata.topic && String(n.metadata.topic).toLowerCase().includes(searchTopic))
    );

    const relatedNodeIds = new Set(relatedNodes.map((n) => n.id));

    // Adiciona instruções geradas a partir de conexões do grafo
    const relatedEdges = data.semantic.edges.filter(
      (e) => relatedNodeIds.has(e.source) || relatedNodeIds.has(e.target)
    );

    // Traduz relacionamentos fortes em instruções de prevenção/sucesso
    for (const edge of relatedEdges) {
      if (edge.weight >= 0.6) {
        const sourceNode = data.semantic.nodes.find((n) => n.id === edge.source);
        const targetNode = data.semantic.nodes.find((n) => n.id === edge.target);
        if (sourceNode && targetNode) {
          if (edge.relation === 'causes_failure' || edge.relation === 'fails_with') {
            resolvedRules.push(
              `Evitar: "${sourceNode.label}" causa falha com "${targetNode.label}".`
            );
          } else if (edge.relation === 'improves_quality' || edge.relation === 'supports') {
            resolvedRules.push(
              `Recomendado: Usar "${sourceNode.label}" com "${targetNode.label}".`
            );
          }
        }
      }
    }

    // Dedup mantendo a ordem de relevância (Sessão primeiro)
    return Array.from(new Set(resolvedRules)).slice(0, 5); // Limita a 5 regras para controle de tokens
  }
}
