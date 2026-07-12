import { SpeechProviderBase } from "./speech-provider";

interface WhisperProviderOptions {
  endpoint?: string;
  timesliceMs?: number;
}

interface TranscribeResponse {
  text?: unknown;
  error?: unknown;
}

const DEFAULT_ENDPOINT = "/api/speech/transcribe";
const DEFAULT_TIMESLICE_MS = 1800;
const DEFAULT_MIME_TYPE = "audio/webm";

function getSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export class WhisperProvider extends SpeechProviderBase {
  private readonly endpoint: string;
  private readonly timesliceMs: number;
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private mimeType = DEFAULT_MIME_TYPE;
  private isRecording = false;
  private isSending = false;
  private hasPendingTranscription = false;
  private pendingResolvers: Array<() => void> = [];
  private accumulatedTranscript = "";
  private lastSnapshotWordCount = 0;

  constructor(options: WhisperProviderOptions = {}) {
    super();
    this.endpoint = options.endpoint || DEFAULT_ENDPOINT;
    this.timesliceMs = options.timesliceMs || DEFAULT_TIMESLICE_MS;
  }

  async start(): Promise<void> {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Captura de audio nao esta disponivel neste navegador.");
    }

    this.audioChunks = [];
    this.hasPendingTranscription = false;
    this.accumulatedTranscript = "";
    this.lastSnapshotWordCount = 0;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.mimeType = recorder.mimeType || mimeType || DEFAULT_MIME_TYPE;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
        this.scheduleTranscription();
      }
    };
    recorder.onerror = () => {
      this.emitError(new Error("Falha ao capturar audio do microfone."));
    };

    this.stream = stream;
    this.mediaRecorder = recorder;
    this.isRecording = true;
    recorder.start(this.timesliceMs);
    this.emitStatus("recording");
  }

  async stop(): Promise<void> {
    const recorder = this.mediaRecorder;
    this.isRecording = false;

    if (recorder && recorder.state !== "inactive") {
      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
      });
      recorder.requestData();
      recorder.stop();
      await stopped;
    }

    this.mediaRecorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    await this.waitForPendingTranscriptions();
    this.emitStatus("idle");
  }

  private scheduleTranscription(): void {
    if (this.isSending) {
      this.hasPendingTranscription = true;
      return;
    }

    void this.processTranscriptionQueue();
  }

  private async processTranscriptionQueue(): Promise<void> {
    this.isSending = true;

    try {
      do {
        this.hasPendingTranscription = false;
        await this.sendCurrentRecording();
      } while (this.hasPendingTranscription);
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error("Falha ao enviar audio para transcricao."));
    } finally {
      this.isSending = false;
      this.resolvePendingWaiters();
      this.emitStatus(this.isRecording ? "recording" : "idle");
    }
  }

  private async waitForPendingTranscriptions(): Promise<void> {
    if (!this.isSending) return;

    await new Promise<void>((resolve) => {
      this.pendingResolvers.push(resolve);
    });
  }

  private resolvePendingWaiters(): void {
    const resolvers = this.pendingResolvers;
    this.pendingResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  private async sendCurrentRecording(): Promise<void> {
    if (this.audioChunks.length === 0) return;

    const audio = new Blob(this.audioChunks, { type: this.mimeType });
    const formData = new FormData();
    formData.set("audio", audio, this.getAudioFileName());
    this.emitStatus("sending");

    const response = await fetch(this.endpoint, {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json().catch(() => ({}))) as TranscribeResponse;
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : "Falha ao transcrever audio.";
      throw new Error(message);
    }

    if (typeof payload.text === "string" && payload.text.trim()) {
      this.emitStableTranscript(payload.text);
    }
  }

  private emitStableTranscript(text: string): void {
    const words = this.getWords(text);
    if (words.length <= this.lastSnapshotWordCount) return;

    const newWords = words.slice(this.lastSnapshotWordCount);
    this.lastSnapshotWordCount = words.length;
    this.accumulatedTranscript = [this.accumulatedTranscript, newWords.join(" ")]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    this.emitTranscript(this.accumulatedTranscript);
  }

  private getWords(text: string): string[] {
    return text.trim().split(/\s+/).filter(Boolean);
  }

  private getAudioFileName(): string {
    if (this.mimeType.includes("mp4")) return "speech.mp4";
    return "speech.webm";
  }
}
