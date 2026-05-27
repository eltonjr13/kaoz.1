export type LipSyncInput = {
  avatarPath: string;
  audioPath: string;
  jobId: string;
};

export type LipSyncResult = {
  videoPath: string;
};

export async function createLipSyncVideo(input: LipSyncInput): Promise<LipSyncResult> {
  // O usuário ainda não definiu a ferramenta de lip-sync e fará a animação de forma manual.
  // Por isso, retornamos diretamente o caminho do vídeo/imagem do avatar original.
  return {
    videoPath: input.avatarPath
  };
}
