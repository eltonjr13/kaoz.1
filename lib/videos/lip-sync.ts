import { generateLipSync } from "@/lib/ai/lipsync";
import type { LipSyncInput, LipSyncResult } from "@/lib/ai/lipsync";

/**
 * Compatibility wrapper for the existing video pipeline.
 * New providers should be implemented in lib/ai/lipsync.ts and exposed through
 * the LipSyncProvider abstraction instead of adding engine-specific code here.
 */
export async function createLipSyncVideo(input: LipSyncInput): Promise<LipSyncResult> {
  return generateLipSync(input);
}

export type { LipSyncInput, LipSyncResult };
