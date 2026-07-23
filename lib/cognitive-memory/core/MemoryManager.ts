import { EventBus } from './EventBus';
import { HierarchicalResolver } from './HierarchicalResolver';
import { Hippocampus } from '../subsystems/Hippocampus';
import { CerebralCortex } from '../subsystems/CerebralCortex';
import { PrefrontalCortex } from '../subsystems/PrefrontalCortex';
import { Amygdala } from '../subsystems/Amygdala';
import { JsonStorageProvider } from '../storage/JsonStorageProvider';
import type { EpisodicMemoryNode, TaskType } from '../types/memory';
import type { GraphEdge, GraphNode } from '../types/graph';

export class MemoryManager {
  private static instance: MemoryManager;
  private storage = new JsonStorageProvider();
  private resolver = new HierarchicalResolver();
  private bus = EventBus.getInstance();

  public hippocampus = new Hippocampus(this.storage);
  public cerebralCortex = new CerebralCortex(this.storage);
  public prefrontalCortex = new PrefrontalCortex(this.storage);
  public amygdala = new Amygdala(this.storage);

  private constructor() {
    this.setupListeners();
  }

  public static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  public async getActiveInstructions(
    avatarId: string,
    topic: string,
    taskType: TaskType,
    context: { projectId?: string; sessionId?: string } = {}
  ): Promise<string[]> {
    const data = await this.storage.readMemory();
    return this.resolver.resolvePromptInstructions(data, avatarId, topic, taskType, context);
  }

  public async recordEpisode(episode: Omit<EpisodicMemoryNode, 'id' | 'timestamp'>): Promise<EpisodicMemoryNode> {
    const newEpisode: EpisodicMemoryNode = {
      ...episode,
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(),
      timestamp: new Date().toISOString()
    };

    await this.hippocampus.addEpisode(newEpisode);
    await this.projectEpisodeToSemanticGraph(newEpisode);
    this.bus.publish('EPISODE_RECORDED', newEpisode);

    return newEpisode;
  }

  public async projectRecordedEpisodesToSemanticGraph(): Promise<void> {
    const data = await this.storage.readMemory();
    const existingNodeIds = new Set(data.semantic.nodes.map((node) => node.id));

    for (const episode of data.episodic.nodes) {
      const outcomeNodeId = this.getEpisodeOutcomeNodeId(episode);
      if (!existingNodeIds.has(outcomeNodeId)) {
        await this.projectEpisodeToSemanticGraph(episode);
        existingNodeIds.add(outcomeNodeId);
      }
    }
  }

  public async submitUserFeedback(jobId: string, feedback: 'good' | 'bad'): Promise<void> {
    const data = await this.storage.readMemory();
    // Procura por jobId na lista de episódios
    const episode = data.episodic.nodes.find(
      (n) => n.rawDetails?.jobId === jobId || n.id === jobId || n.projectId === jobId
    );

    if (episode) {
      const updated = await this.amygdala.modulateEmotionalWeight(episode.id, feedback);
      if (updated) {
        await this.projectEpisodeToSemanticGraph(updated);
        this.bus.publish('EPISODE_UPDATED', updated);
      }
    } else {
      console.warn(`[MemoryManager] Episódio correspondente ao jobId ${jobId} não encontrado.`);
    }
  }

  private setupListeners() {
    // Carrega o refletor para registrar os listeners básicos
    import('../background/Reflector').then(({ reflector }) => {
      console.info("[MemoryManager] Reflector carregado com sucesso.");
    }).catch(e => console.error("Erro ao iniciar Reflector:", e));

    // Ouvintes para detecção de contradições, padrões e pruner de memória
    this.bus.subscribe('EPISODE_RECORDED', async (episode: EpisodicMemoryNode) => {
      try {
        const { conflictResolver } = await import('../background/ConflictResolver');
        await conflictResolver.resolveSemanticConflicts();
        
        const { patternDetector } = await import('../background/PatternDetector');
        await patternDetector.detectFailurePatterns(episode.avatarId);

        const { graphPruner } = await import('../background/GraphPruner');
        await graphPruner.compressEpisodicMemory(episode.avatarId, 50);
        await graphPruner.decaySemanticGraph(episode.avatarId);
      } catch (err) {
        console.error("[MemoryManager] Erro no fluxo de pós-execução do barramento:", err);
      }
    });
  }

  private async projectEpisodeToSemanticGraph(episode: EpisodicMemoryNode): Promise<void> {
    const now = new Date().toISOString();
    const topic = episode.projectId || episode.inputPrompt || episode.taskType;
    const nodes = this.createEpisodeGraphNodes(episode, topic, now);
    const edges = this.createEpisodeGraphEdges(episode, topic, now);

    for (const node of nodes) {
      await this.cerebralCortex.upsertNode(node);
    }

    for (const edge of edges) {
      await this.cerebralCortex.upsertEdge(edge);
    }
  }

  private createEpisodeGraphNodes(episode: EpisodicMemoryNode, topic: string, now: string): GraphNode[] {
    const taskLabel = this.formatTaskType(episode.taskType);

    return [
      {
        id: 'concept:kaoz1-agent',
        label: 'Kaoz.1',
        type: 'concept',
        description: 'Nucleo autonomo que registra execucoes, resultados e aprendizados operacionais.',
        confidenceScore: 1,
        lastObserved: now,
        metadata: { system: true }
      },
      {
        id: this.getAvatarNodeId(episode.avatarId),
        label: `Avatar ${episode.avatarId.slice(0, 8)}`,
        type: 'entity',
        description: 'Avatar usado pelo Kaoz.1 nesta execucao.',
        confidenceScore: 0.9,
        lastObserved: now,
        metadata: { avatarId: episode.avatarId }
      },
      {
        id: this.getTaskNodeId(episode.taskType),
        label: taskLabel,
        type: 'concept',
        description: `Tipo de tarefa executada pelo agente: ${taskLabel}.`,
        confidenceScore: 0.9,
        lastObserved: now,
        metadata: { taskType: episode.taskType }
      },
      this.createModelNode(episode, now),
      this.createTopicNode(episode, topic, now),
      this.createOutcomeNode(episode, topic, now)
    ];
  }

  private createModelNode(episode: EpisodicMemoryNode, now: string): GraphNode {
    const modelUsed = episode.modelUsed || 'Modelo desconhecido';

    return {
      id: this.getModelNodeId(modelUsed),
      label: modelUsed,
      type: 'entity',
      description: `Modelo ou pipeline usado pelo agente: ${modelUsed}.`,
      confidenceScore: 0.9,
      lastObserved: now,
      metadata: { modelUsed }
    };
  }

  private createTopicNode(episode: EpisodicMemoryNode, topic: string, now: string): GraphNode {
    return {
      id: this.getTopicNodeId(topic),
      label: this.truncate(topic, 72),
      type: 'concept',
      description: `Tema registrado pelo agente: ${topic}`,
      confidenceScore: 0.75,
      lastObserved: now,
      metadata: {
        avatarId: episode.avatarId,
        taskType: episode.taskType,
        topic,
        inputPrompt: episode.inputPrompt
      }
    };
  }

  private createOutcomeNode(episode: EpisodicMemoryNode, topic: string, now: string): GraphNode {
    const success = episode.status === 'success';

    return {
      id: this.getEpisodeOutcomeNodeId(episode),
      label: `${success ? 'Sucesso' : 'Falha'}: ${this.formatTaskType(episode.taskType)}`,
      type: success ? 'tool-outcome' : 'error-pattern',
      description: episode.outputSummary || episode.errorMessage || `Resultado registrado para ${topic}.`,
      confidenceScore: success ? 0.78 : 0.7,
      lastObserved: now,
      metadata: {
        avatarId: episode.avatarId,
        taskType: episode.taskType,
        topic,
        modelUsed: episode.modelUsed,
        inputPrompt: episode.inputPrompt,
        outputSummary: episode.outputSummary,
        errorMessage: episode.errorMessage,
        userFeedback: episode.userFeedback || null,
        sourceEpisodeId: episode.id
      }
    };
  }

  private createEpisodeGraphEdges(episode: EpisodicMemoryNode, topic: string, now: string): GraphEdge[] {
    const avatarNodeId = this.getAvatarNodeId(episode.avatarId);
    const taskNodeId = this.getTaskNodeId(episode.taskType);
    const modelNodeId = this.getModelNodeId(episode.modelUsed || 'Modelo desconhecido');
    const topicNodeId = this.getTopicNodeId(topic);
    const outcomeNodeId = this.getEpisodeOutcomeNodeId(episode);
    const resultRelation = episode.status === 'success' ? 'improves_quality' : 'fails_with';

    return [
      this.createGraphEdge('concept:kaoz1-agent', avatarNodeId, 'uses_avatar', 0.7, now),
      this.createGraphEdge(avatarNodeId, taskNodeId, 'performs_task', 0.7, now),
      this.createGraphEdge(taskNodeId, modelNodeId, 'uses_model', 0.75, now),
      this.createGraphEdge(modelNodeId, topicNodeId, resultRelation, episode.status === 'success' ? 0.72 : 0.82, now),
      this.createGraphEdge(topicNodeId, outcomeNodeId, 'records_outcome', 0.9, now, episode.id)
    ];
  }

  private createGraphEdge(
    source: string,
    target: string,
    relation: string,
    weight: number,
    now: string,
    suffix?: string
  ): GraphEdge {
    const edgeId = suffix
      ? `edge:${source}->${target}:${relation}:${suffix}`
      : `edge:${source}->${target}:${relation}`;

    return {
      id: edgeId,
      source,
      target,
      relation,
      weight,
      confidenceScore: weight,
      occurrences: 1,
      lastReinforced: now
    };
  }

  private getAvatarNodeId(avatarId: string): string {
    return `entity:avatar-${this.slugify(avatarId)}`;
  }

  private getTaskNodeId(taskType: TaskType): string {
    return `concept:task-${this.slugify(taskType)}`;
  }

  private getModelNodeId(modelUsed: string): string {
    return `entity:model-${this.slugify(modelUsed)}`;
  }

  private getTopicNodeId(topic: string): string {
    return `concept:topic-${this.slugify(topic, 80)}`;
  }

  private getEpisodeOutcomeNodeId(episode: EpisodicMemoryNode): string {
    return `outcome:${episode.id}`;
  }

  private formatTaskType(taskType: TaskType): string {
    const labels: Record<TaskType, string> = {
      image: 'Imagem',
      video: 'Video',
      project: 'Projeto',
      refine: 'Refinamento',
      'ad-creative': 'Criativo de anuncio'
    };

    return labels[taskType];
  }

  private slugify(value: string, maxLength = 64): string {
    const slug = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength)
      .replace(/-+$/g, '');

    return slug || 'desconhecido';
  }

  private truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
  }
}
export const memoryManager = MemoryManager.getInstance();
