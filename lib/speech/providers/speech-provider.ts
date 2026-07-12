export type SpeechProviderStatus = "idle" | "recording" | "sending";

export interface SpeechProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  onTranscript(callback: (text: string) => void): void;
  onError(callback: (error: Error) => void): void;
  onStatus(callback: (status: SpeechProviderStatus) => void): void;
}

export abstract class SpeechProviderBase implements SpeechProvider {
  private transcriptCallbacks = new Set<(text: string) => void>();
  private errorCallbacks = new Set<(error: Error) => void>();
  private statusCallbacks = new Set<(status: SpeechProviderStatus) => void>();

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  onTranscript(callback: (text: string) => void): void {
    this.transcriptCallbacks.add(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.add(callback);
  }

  onStatus(callback: (status: SpeechProviderStatus) => void): void {
    this.statusCallbacks.add(callback);
  }

  protected emitTranscript(text: string): void {
    this.transcriptCallbacks.forEach((callback) => callback(text));
  }

  protected emitError(error: Error): void {
    this.errorCallbacks.forEach((callback) => callback(error));
  }

  protected emitStatus(status: SpeechProviderStatus): void {
    this.statusCallbacks.forEach((callback) => callback(status));
  }
}
