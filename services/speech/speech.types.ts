export type SpeechProviderName = "whisper" | "whisper-speed" | "webspeech" | "parakeet";
export type SpeechRuntimeEnvironment = "web" | "desktop";
export type SpeechEngine = "webspeech" | "cloud" | "whisper-cpp" | "parakeet";
export type SpeechDevicePreference = "auto" | "vulkan" | "cpu";
export type SpeechExecutionBackend = "web" | "cloud" | "vulkan" | "cpu" | "parakeet";
export type SpeechModelInstallState =
  | "not-installed"
  | "partial"
  | "queued"
  | "downloading"
  | "verifying"
  | "ready"
  | "error";

export interface SpeechModelDefinition {
  id: string;
  engine: "whisper-cpp" | "parakeet";
  name: string;
  description: string;
  fileName: string;
  downloadUrl?: string;
  checksum?: { algorithm: "sha1" | "sha256"; value: string };
  sizeBytes: number;
  memoryBytes?: number;
  multilingual: boolean;
  quantized: boolean;
  recommended?: boolean;
  quality: "basic" | "balanced" | "high" | "highest";
}

export interface SpeechModelStatus extends SpeechModelDefinition {
  state: SpeechModelInstallState;
  downloadedBytes: number;
  error?: string;
  installedPath?: string;
}

export interface SpeechHardwareStatus {
  checkedAt: string;
  vulkanAvailable: boolean;
  deviceName?: string;
  backend: "vulkan" | "cpu";
  message: string;
}

export interface SpeechRuntimeConfig {
  provider: SpeechProviderName;
  chunkMs: number;
  engine: SpeechEngine;
  modelId: string | null;
  device: SpeechDevicePreference;
  allowCloudFallback: boolean;
}

export interface SpeechTranscriptionResult {
  text: string;
  engine?: SpeechEngine;
  modelId?: string;
  backend?: SpeechExecutionBackend;
  deviceName?: string;
}

export interface SpeechTranscriptionOptions {
  modelId?: string | null;
  device?: SpeechDevicePreference;
  allowCloudFallback?: boolean;
}

export interface PythonSpeechResponse {
  text?: unknown;
  error?: unknown;
}

export interface SpeechSettings {
  provider: SpeechProviderName;
  modelId: string | null;
  device: SpeechDevicePreference;
  allowCloudFallback: boolean;
}

export type ParakeetRuntimeState = "inactive" | "downloading" | "ready" | "error";

export interface ParakeetRuntimeStatus {
  state: ParakeetRuntimeState;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
}
