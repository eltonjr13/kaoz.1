import type { CognitiveMemoryData } from '../storage/IStorageProvider';
import type { TaskType } from '../types/memory';

function collectHierarchicalRules(
  rules: CognitiveMemoryData['procedural']['rules'],
  avatarId: string,
  context: { projectId?: string; sessionId?: string }
): string[] {
  const { projectId, sessionId } = context;
  const activeRules = rules.filter((r) => r.confidenceScore >= 0.3);
  const resolvedRules: string[] = [];

  if (sessionId) {
    const sessionRules = activeRules.filter(
      (r) => r.sessionId === sessionId && r.avatarId === avatarId
    );
    resolvedRules.push(...sessionRules.map((r) => r.instruction));
  }

  if (projectId) {
    const projectRules = activeRules.filter(
      (r) => r.projectId === projectId && r.avatarId === avatarId && !r.sessionId
    );
    resolvedRules.push(...projectRules.map((r) => r.instruction));
  }

  const avatarRules = activeRules.filter(
    (r) => r.avatarId === avatarId && !r.projectId && !r.sessionId
  );
  resolvedRules.push(...avatarRules.map((r) => r.instruction));

  const globalRules = activeRules.filter(
    (r) => (r.avatarId === 'global' || r.avatarId === 'all') && !r.projectId && !r.sessionId
  );
  resolvedRules.push(...globalRules.map((r) => r.instruction));

  return resolvedRules;
}

function matchesTopic(node: CognitiveMemoryData['semantic']['nodes'][0], searchTopic: string): boolean {
  const label = node.label.toLowerCase();
  const metadataTopic = node.metadata?.topic ? String(node.metadata.topic).toLowerCase() : '';
  return searchTopic.includes(label) || label.includes(searchTopic) || metadataTopic.includes(searchTopic);
}

function formatEdgeInstruction(
  edge: CognitiveMemoryData['semantic']['edges'][0],
  sourceLabel: string,
  targetLabel: string
): string | null {
  if (edge.relation === 'causes_failure' || edge.relation === 'fails_with') {
    return `Evitar: "${sourceLabel}" causa falha com "${targetLabel}".`;
  }
  if (edge.relation === 'improves_quality' || edge.relation === 'supports') {
    return `Recomendado: Usar "${sourceLabel}" com "${targetLabel}".`;
  }
  return null;
}

function collectSemanticGraphInstructions(semantic: CognitiveMemoryData['semantic'], topic: string): string[] {
  const searchTopic = topic.toLowerCase().trim();
  const relatedNodes = semantic.nodes.filter((n) => matchesTopic(n, searchTopic));
  const relatedNodeIds = new Set(relatedNodes.map((n) => n.id));
  const relatedEdges = semantic.edges.filter(
    (e) => e.weight >= 0.6 && (relatedNodeIds.has(e.source) || relatedNodeIds.has(e.target))
  );

  const instructions: string[] = [];
  const nodeMap = new Map(semantic.nodes.map((n) => [n.id, n.label]));

  for (const edge of relatedEdges) {
    const sourceLabel = nodeMap.get(edge.source);
    const targetLabel = nodeMap.get(edge.target);
    if (sourceLabel && targetLabel) {
      const instruction = formatEdgeInstruction(edge, sourceLabel, targetLabel);
      if (instruction) instructions.push(instruction);
    }
  }

  return instructions;
}

export class HierarchicalResolver {
  public resolvePromptInstructions(
    data: CognitiveMemoryData,
    avatarId: string,
    topic: string,
    _taskType: TaskType,
    context: { projectId?: string; sessionId?: string } = {}
  ): string[] {
    const hierarchical = collectHierarchicalRules(data.procedural.rules, avatarId, context);
    const semantic = collectSemanticGraphInstructions(data.semantic, topic);
    return Array.from(new Set([...hierarchical, ...semantic])).slice(0, 5);
  }
}
