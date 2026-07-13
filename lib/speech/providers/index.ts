import { SpeechProviderBase, type SpeechProvider } from "./speech-provider";
import { WebSpeechProvider } from "./webspeech-provider";
import { WhisperProvider } from "./whisper-provider";

export type { SpeechProvider, SpeechProviderStatus } from "./speech-provider";
export { WebSpeechProvider } from "./webspeech-provider";
export { WhisperProvider } from "./whisper-provider";

type SpeechProviderName = "whisper" | "whisper-speed" | "webspeech" | "parakeet";

interface SpeechConfigResponse {
  provider?: unknown;
  chunkMs?: unknown;
}

function normalizeProvider(value: unknown): SpeechProviderName {
  if (value === "whisper") return value;
  if (value === "whisper-speed") return value;
  if (value === "parakeet") return value;
  return value === "webspeech" ? "webspeech" : "whisper";
}

function normalizeChunkMs(value: unknown, provider: SpeechProviderName): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (provider === "whisper-speed") return 1200;
  if (provider === "whisper") return 2600;
  if (provider === "parakeet") return 30_000;
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
  private stopped = false;
  private fallbackStarted = false;

  private attach(provider: SpeechProvider, canFallbackFromNetworkError: boolean, timesliceMs?: number): void {
    provider.onTranscript((text) => {
      if (this.provider === provider) this.emitTranscript(text);
    });
    provider.onError((error) => {
      if (this.provider !== provider) return;
      if (canFallbackFromNetworkError && /network/i.test(error.message)) {
        void this.startRecorderFallback(timesliceMs);
        return;
      }
      this.emitError(error);
    });
    provider.onStatus((status) => {
      // Web Speech emits idle immediately after its network failure. Keep the
      // UI recording while the recorder fallback is being started.
      if (this.provider === provider && !this.fallbackStarted) this.emitStatus(status);
    });
  }

  private async startRecorderFallback(timesliceMs?: number): Promise<void> {
    if (this.stopped || this.fallbackStarted) return;
    this.fallbackStarted = true;

    const failedProvider = this.provider;
    try {
      await failedProvider?.stop();
      if (this.stopped) return;

      const fallback = new WhisperProvider({ timesliceMs });
      this.provider = fallback;
      this.attach(fallback, false, timesliceMs);
      await fallback.start();
      this.fallbackStarted = false;
    } catch (error) {
      this.fallbackStarted = false;
      this.emitError(new Error(
        `O reconhecimento Web nao conseguiu acessar a rede e a transcricao alternativa falhou: ${error instanceof Error ? error.message : String(error)}`
      ));
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.fallbackStarted = false;
    const config = await loadSpeechConfig();
    const electronRuntime = isElectronRuntime();
    // Electron's Chromium exposes parts of the Web Speech surface, but does not
    // reliably provide Chrome's remote recognition service. Record once and use
    // the server fallback instead of repeatedly reopening the Windows microphone.
    // A long timeslice makes ordinary desktop dictation a single request on stop,
    // avoiding repeated cloud calls when Python is not installed.
    const provider = config.provider === "webspeech" && !electronRuntime
      ? new WebSpeechProvider()
      : new WhisperProvider({ timesliceMs: config.provider === "parakeet" ? 30_000 : (electronRuntime ? 30_000 : config.chunkMs) });

    this.provider = provider;
    this.attach(provider, config.provider === "webspeech" && !electronRuntime, config.chunkMs);
    await provider.start();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.provider?.stop();
    this.provider = null;
    this.emitStatus("idle");
  }
}

export function createSpeechProvider(): SpeechProvider {
  return new ConfiguredSpeechProvider();
}
