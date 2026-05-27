import type { ViralVideo } from "@/types";

export type ViralSearchInput = {
  topic: string;
  limit?: number;
};

export async function searchViralVideos(input: ViralSearchInput): Promise<ViralVideo[]> {
  void input;
  throw new Error("Integre o provedor de busca viral em lib/videos/viral-search.ts.");
}
