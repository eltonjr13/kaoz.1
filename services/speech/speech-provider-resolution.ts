import type { SpeechProviderName, SpeechRuntimeEnvironment } from "./speech.types";

export function speechRuntimeEnvironment(value?: unknown): SpeechRuntimeEnvironment {
  if (value === "desktop") return "desktop";
  if (value === "web") return "web";
  return process.env.KAOZ1_DESKTOP === "1" || process.env.MRCHICKEN_DESKTOP === "1"
    ? "desktop"
    : "web";
}

export function resolveSpeechProvider(
  preferred: SpeechProviderName,
  runtime?: SpeechRuntimeEnvironment,
): SpeechProviderName {
  if (speechRuntimeEnvironment(runtime) === "web") return "webspeech";
  return preferred;
}

export function resolveServerSpeechProvider(
  preferred: SpeechProviderName,
  runtime?: SpeechRuntimeEnvironment,
): SpeechProviderName {
  const provider = resolveSpeechProvider(preferred, runtime);
  if (speechRuntimeEnvironment(runtime) === "web") return "webspeech";
  return provider === "webspeech" ? "whisper-speed" : provider;
}
