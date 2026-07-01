import { SpeechProviderBase } from "./speech-provider";

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0?: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  error?: string;
  message?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function combineText(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

function getNativeSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
}

function createNativeSpeechRecognition() {
  const Recognition = getNativeSpeechRecognition();
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "pt-BR";
  return recognition;
}

export class WebSpeechProvider extends SpeechProviderBase {
  private recognition: BrowserSpeechRecognition | null = null;
  private finalTranscript = "";

  async start(): Promise<void> {
    const recognition = createNativeSpeechRecognition();
    if (!recognition) {
      throw new Error("Transcricao nativa nao esta disponivel neste navegador.");
    }

    this.finalTranscript = "";
    recognition.onresult = (event) => {
      let nextFinalText = this.finalTranscript;
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) {
          nextFinalText = combineText(nextFinalText, transcript);
        } else {
          interimText = combineText(interimText, transcript);
        }
      }

      this.finalTranscript = nextFinalText;
      this.emitTranscript(combineText(this.finalTranscript, interimText));
    };

    recognition.onerror = (event) => {
      const message = event.error === "no-speech"
        ? "Nenhuma voz detectada."
        : event.message || event.error || "Falha ao reconhecer audio pelo navegador.";
      this.emitError(new Error(message));
      this.emitStatus("idle");
    };

    recognition.onend = () => {
      this.recognition = null;
      this.emitTranscript(this.finalTranscript);
      this.emitStatus("idle");
    };

    recognition.start();
    this.recognition = recognition;
    this.emitStatus("recording");
  }

  async stop(): Promise<void> {
    const recognition = this.recognition;
    if (!recognition) {
      this.emitStatus("idle");
      return;
    }

    recognition.stop();
    this.recognition = null;
    this.emitTranscript(this.finalTranscript);
    this.emitStatus("idle");
  }
}
