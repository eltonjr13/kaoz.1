import type { FishAudioExpressionLevel } from "@/lib/ai/agent-voice";

export type TTSProviderName = "cartesia" | "browser" | "elevenlabs" | "omnivoice" | "fish-audio";

export interface TTSConfig {
  provider: TTSProviderName;
  cartesiaApiKey?: string;
  cartesiaVoiceId?: string;
  cartesiaModel?: string; // e.g. "sonic-english" ou "sonic"
  cartesiaSpeed?: string; // e.g. "normal", "fast", "slow"
  cartesiaEmotion?: string; // e.g. "happy", "sad", "anger"
  fishAudioApiKey?: string;
  fishAudioReferenceId?: string;
  fishAudioModel?: string;
  fishAudioExpressionLevel?: FishAudioExpressionLevel;
}

export interface TTSProviderStatus {
  isActive: boolean;
  message?: string;
}
