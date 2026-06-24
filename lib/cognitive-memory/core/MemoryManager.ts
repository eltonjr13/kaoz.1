import { EventBus } from './EventBus';
import { HierarchicalResolver } from './HierarchicalResolver';
import { EpisodicMemory } from '../subsystems/EpisodicMemory';
import { SemanticMemory } from '../subsystems/SemanticMemory';
import { ProceduralMemory } from '../subsystems/ProceduralMemory';
import { JsonStorageProvider } from '../storage/JsonStorageProvider';
import type { EpisodicMemoryNode, TaskType } from '../types/memory';

export class MemoryManager {
  private static instance: MemoryManager;
  private storage = new JsonStorageProvider();
  private resolver = new HierarchicalResolver();
  private bus = EventBus.getInstance();

  public episodic = new EpisodicMemory(this.storage);
  public semantic = new SemanticMemory(this.storage);
  public procedural = new ProceduralMemory(this.storage);

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

    await this.episodic.addEpisode(newEpisode);
    this.bus.publish('EPISODE_RECORDED', newEpisode);

    return newEpisode;
  }

  public async submitUserFeedback(jobId: string, feedback: 'good' | 'bad'): Promise<void> {
    const data = await this.storage.readMemory();
    // Procura por jobId na lista de episódios
    const episode = data.episodic.nodes.find(
      (n) => n.rawDetails?.jobId === jobId || n.id === jobId || n.projectId === jobId
    );

    if (episode) {
      const updated = await this.episodic.updateEpisodeFeedback(episode.id, feedback);
      if (updated) {
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
}
export const memoryManager = MemoryManager.getInstance();
