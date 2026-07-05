export type TTSProviderName = "cartesia" | "browser" | "elevenlabs" | "omnivoice";

export interface TTSConfig {
  provider: TTSProviderName;
  cartesiaApiKey?: string;
  cartesiaVoiceId?: string;
  cartesiaModel?: string; // e.g. "sonic-english" ou "sonic"
  cartesiaSpeed?: string; // e.g. "normal", "fast", "slow"
  cartesiaEmotion?: string; // e.g. "happy", "sad", "anger"
}

export interface TTSProviderStatus {
  isActive: boolean;
  message?: string;
}
