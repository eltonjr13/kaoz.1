export type LipSyncInput = {
  avatarPath: string;
  audioPath: string;
  jobId: string;
};

export type LipSyncResult = {
  videoPath: string;
};

export async function createLipSyncVideo(input: LipSyncInput): Promise<LipSyncResult> {
  void input;

  if (!process.env.LIPSYNC_API_KEY) {
    throw new Error("LIPSYNC_API_KEY nao configurada no servidor.");
  }

  throw new Error("Integre o provedor de lip-sync em lib/videos/lip-sync.ts.");
}
