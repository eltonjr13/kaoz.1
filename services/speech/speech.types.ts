export type SpeechProviderName = "whisper" | "whisper-speed" | "webspeech" | "parakeet";

export interface SpeechRuntimeConfig {
  provider: SpeechProviderName;
  chunkMs: number;
}

export interface SpeechTranscriptionResult {
  text: string;
}

export interface PythonSpeechResponse {
  text?: unknown;
  error?: unknown;
}

export interface SpeechSettings {
  provider: SpeechProviderName;
}

export type ParakeetRuntimeState = "inactive" | "downloading" | "ready" | "error";

export interface ParakeetRuntimeStatus {
  state: ParakeetRuntimeState;
  message: string;
}
