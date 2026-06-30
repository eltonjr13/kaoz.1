import type { IStorageProvider } from '../storage/IStorageProvider';
import type { EpisodicMemoryNode } from '../types/memory';

export class Amygdala {
  constructor(private storage: IStorageProvider) {}

  /**
   * Avalia se uma memória deve ser incluída no contexto baseando-se no seu
   * feedback e pontuação emocional. Filtra falhas persistentes ou lixo.
   */
  public isMemoryValuable(episode: EpisodicMemoryNode): boolean {
    // Se o usuário deu feedback ruim explicito, a amígdala bloqueia o uso positivo dessa memória (exceto para ensinar "o que não fazer")
    if (episode.userFeedback === 'bad') {
      return false; // Neste contexto, 'valuable' significa útil como contexto de sucesso
    }

    // Filtra memórias onde o status de erro persistiu repetidas vezes.
    // Pode ser expandido futuramente para ler pesos do grafo.
    if (episode.status === 'failure' && !episode.outputSummary) {
      return false;
    }

    return true;
  }

  /**
   * Modula o peso emocional de um episódio (feedback).
   * Atualiza o status e a valência associada a esse nó.
   */
  public async modulateEmotionalWeight(episodeId: string, feedback: 'good' | 'bad'): Promise<EpisodicMemoryNode | null> {
    const data = await this.storage.readMemory();
    const episode = data.episodic.nodes.find((n) => n.id === episodeId);
    
    if (!episode) return null;

    episode.userFeedback = feedback;
    episode.status = feedback === 'bad' ? 'failure' : 'success';
    
    // Na Amígdala, feedback 'bad' age como um choque, reduzindo a chance dessa memória ser evocada novamente no futuro.
    // Isso poderia influenciar um 'confidenceScore' interno do episódio, se for adicionado no type.
    
    await this.storage.writeMemory(data);
    return episode;
  }
}
