export type RenderVerticalVideoInput = {
  jobId: string;
  reactionVideoPath: string;
  sourceVideoPath?: string | null;
};

export type RenderVerticalVideoResult = {
  finalVideoPath: string;
};

export async function renderVerticalVideo(input: RenderVerticalVideoInput): Promise<RenderVerticalVideoResult> {
  void input;
  throw new Error("Integre o renderizador vertical em lib/videos/render.ts.");
}
