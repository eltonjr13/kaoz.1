export type SpeechProviderName = "whisper" | "whisper-speed" | "webspeech";

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
