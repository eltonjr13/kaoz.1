import type { IStorageProvider } from '../storage/IStorageProvider';
import type { EpisodicMemoryNode } from '../types/memory';

export class EpisodicMemory {
  constructor(private storage: IStorageProvider) {}

  public async addEpisode(episode: EpisodicMemoryNode): Promise<void> {
    const data = await this.storage.readMemory();
    data.episodic.nodes.push(episode);
    await this.storage.writeMemory(data);
  }

  public async getRecentEpisodes(avatarId: string, limit = 20): Promise<EpisodicMemoryNode[]> {
    const data = await this.storage.readMemory();
    return data.episodic.nodes
      .filter((n) => n.avatarId === avatarId)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, limit);
  }

  public async updateEpisodeFeedback(episodeId: string, feedback: 'good' | 'bad'): Promise<EpisodicMemoryNode | null> {
    const data = await this.storage.readMemory();
    const episode = data.episodic.nodes.find((n) => n.id === episodeId);
    if (!episode) return null;

    episode.userFeedback = feedback;
    episode.status = feedback === 'bad' ? 'failure' : 'success';
    
    await this.storage.writeMemory(data);
    return episode;
  }
}
