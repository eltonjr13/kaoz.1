import type { IStorageProvider } from '../storage/IStorageProvider';
import type { EpisodicMemoryNode } from '../types/memory';

export class Hippocampus {
  private readonly storage: IStorageProvider;

  constructor(storage: IStorageProvider) {
    this.storage = storage;
  }

  public async addEpisode(episode: EpisodicMemoryNode): Promise<void> {
    await this.storage.updateMemory((data) => {
      data.episodic.nodes.push(episode);
    });
  }

  public async getRecentEpisodes(avatarId: string, limit = 20): Promise<EpisodicMemoryNode[]> {
    const data = await this.storage.readMemory();
    return data.episodic.nodes
      .filter((n) => n.avatarId === avatarId)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, limit);
  }

  public async updateEpisodeFeedback(episodeId: string, feedback: 'good' | 'bad'): Promise<EpisodicMemoryNode | null> {
    return this.storage.updateMemory((data) => {
      const episode = data.episodic.nodes.find((n) => n.id === episodeId);
      if (!episode) return null;

      episode.userFeedback = feedback;
      episode.status = feedback === 'bad' ? 'failure' : 'success';
      return episode;
    });
  }
}
