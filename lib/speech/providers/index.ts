import { SpeechProviderBase, type SpeechProvider } from "./speech-provider";
import { WebSpeechProvider } from "./webspeech-provider";
import { WhisperProvider } from "./whisper-provider";

export type { SpeechProvider, SpeechProviderStatus } from "./speech-provider";
export { WebSpeechProvider } from "./webspeech-provider";
export { WhisperProvider } from "./whisper-provider";

type SpeechProviderName = "whisper" | "whisper-speed" | "webspeech";

interface SpeechConfigResponse {
  provider?: unknown;
  chunkMs?: unknown;
}

function normalizeProvider(value: unknown): SpeechProviderName {
  if (value === "whisper") return value;
  if (value === "whisper-speed") return value;
  return value === "webspeech" ? "webspeech" : "whisper";
}

function normalizeChunkMs(value: unknown, provider: SpeechProviderName): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (provider === "whisper-speed") return 1200;
  if (provider === "whisper") return 2600;
  return undefined;
}

async function loadSpeechConfig(): Promise<{ provider: SpeechProviderName; chunkMs?: number }> {
  return fetch("/api/speech/config", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return { provider: "whisper-speed" as const, chunkMs: 1200 };
      const payload = (await response.json().catch(() => ({}))) as SpeechConfigResponse;
      const provider = normalizeProvider(payload.provider);
      return {
        provider,
        chunkMs: normalizeChunkMs(payload.chunkMs, provider),
      };
    })
    .catch(() => ({ provider: "whisper-speed", chunkMs: 1200 }));
}

function isElectronRuntime(): boolean {
  return typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);
}

class ConfiguredSpeechProvider extends SpeechProviderBase {
  private provider: SpeechProvider | null = null;

  async start(): Promise<void> {
    const config = await loadSpeechConfig();
    const electronRuntime = isElectronRuntime();
    // Electron's Chromium exposes parts of the Web Speech surface, but does not
    // reliably provide Chrome's remote recognition service. Record once and use
    // the server fallback instead of repeatedly reopening the Windows microphone.
    // A long timeslice makes ordinary desktop dictation a single request on stop,
    // avoiding repeated cloud calls when Python is not installed.
    const provider = config.provider === "webspeech" && !electronRuntime
      ? new WebSpeechProvider()
      : new WhisperProvider({ timesliceMs: electronRuntime ? 30_000 : config.chunkMs });

    provider.onTranscript((text) => this.emitTranscript(text));
    provider.onError((error) => this.emitError(error));
    provider.onStatus((status) => this.emitStatus(status));

    this.provider = provider;
    await provider.start();
  }

  async stop(): Promise<void> {
    await this.provider?.stop();
    this.provider = null;
    this.emitStatus("idle");
  }
}

export function createSpeechProvider(): SpeechProvider {
  return new ConfiguredSpeechProvider();
}
