export type WebSpeechMediaSegment = {
  start: number;
  end: number;
  text: string;
};

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type BrowserSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
};

type BrowserSpeechRecognitionErrorEvent = Event & {
  error?: string;
  message?: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  abort: () => void;
  start: (audioTrack?: MediaStreamTrack) => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type WebSpeechWindow = typeof window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

function browserConstructors() {
  if (typeof window === "undefined") return null;
  const browserWindow = window as WebSpeechWindow;
  const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
  const AudioContextConstructor = browserWindow.AudioContext || browserWindow.webkitAudioContext;
  return Recognition && AudioContextConstructor ? { Recognition, AudioContextConstructor } : null;
}

export function supportsWebSpeechMedia(): boolean {
  return Boolean(browserConstructors());
}

function errorMessage(event: BrowserSpeechRecognitionErrorEvent): string {
  if (event.error === "not-allowed" || event.error === "service-not-allowed") {
    return "O navegador bloqueou o reconhecimento Web Speech.";
  }
  if (event.error === "audio-capture") {
    return "Este navegador não aceita a faixa do vídeo no Web Speech.";
  }
  if (event.error === "network") {
    return "O serviço Web Speech do navegador está indisponível ou sem conexão.";
  }
  return event.message || event.error || "Falha ao transcrever o vídeo com Web Speech.";
}

export async function transcribeMediaWithWebSpeech(
  sourceUrl: string,
  onProgress?: (currentSeconds: number, durationSeconds: number) => void,
): Promise<WebSpeechMediaSegment[]> {
  const constructors = browserConstructors();
  if (!constructors) {
    throw new Error("Este navegador não oferece Web Speech para faixas de áudio. Use uma versão recente do Chrome.");
  }

  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.src = sourceUrl;
  const audioContext = new constructors.AudioContextConstructor();
  const sourceNode = audioContext.createMediaElementSource(audio);
  const streamDestination = audioContext.createMediaStreamDestination();
  sourceNode.connect(streamDestination);
  const audioTrack = streamDestination.stream.getAudioTracks()[0];
  if (!audioTrack) {
    await audioContext.close();
    throw new Error("Não foi possível capturar a faixa de áudio do vídeo no navegador.");
  }

  const segments: WebSpeechMediaSegment[] = [];
  let activeRecognition: BrowserSpeechRecognition | null = null;
  let finished = false;
  let lastSegmentEnd = 0;
  let restartTimer: number | undefined;

  const cleanup = async () => {
    finished = true;
    if (restartTimer !== undefined) window.clearTimeout(restartTimer);
    activeRecognition?.abort();
    activeRecognition = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioTrack.stop();
    await audioContext.close().catch(() => undefined);
  };

  try {
    return await new Promise<WebSpeechMediaSegment[]>((resolve, reject) => {
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        reject(error);
      };

      const startRecognition = () => {
        if (finished || audio.ended) return;
        const recognition = new constructors.Recognition();
        activeRecognition = recognition;
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "pt-BR";
        recognition.onresult = (event) => {
          const finalTexts: string[] = [];
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const text = result[0]?.transcript?.trim();
            if (result.isFinal && text) finalTexts.push(text);
          }
          if (!finalTexts.length) return;
          const end = Math.max(lastSegmentEnd + 0.1, Math.min(audio.duration || audio.currentTime, audio.currentTime));
          segments.push({ start: lastSegmentEnd, end, text: finalTexts.join(" ") });
          lastSegmentEnd = end;
        };
        recognition.onerror = (event) => {
          if (event.error === "no-speech" || event.error === "aborted") return;
          fail(new Error(errorMessage(event)));
        };
        recognition.onend = () => {
          if (activeRecognition === recognition) activeRecognition = null;
          if (!finished && !audio.ended) {
            restartTimer = window.setTimeout(startRecognition, 120);
          }
        };
        try {
          recognition.start(audioTrack);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      };

      audio.addEventListener("timeupdate", () => {
        onProgress?.(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0);
      });
      audio.addEventListener("error", () => fail(new Error("O navegador não conseguiu carregar o áudio do vídeo.")), { once: true });
      audio.addEventListener("ended", () => {
        if (finished) return;
        finished = true;
        activeRecognition?.stop();
        const textSegments = segments.filter((segment) => segment.text.trim());
        if (!textSegments.length) {
          reject(new Error("O Web Speech terminou sem retornar texto. Confirme o suporte do Chrome e o idioma do áudio."));
          return;
        }
        resolve(textSegments);
      }, { once: true });

      void audioContext.resume().catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
      startRecognition();
      void audio.play().catch(() => fail(new Error("O navegador bloqueou a reprodução necessária para transcrever o vídeo.")));
    });
  } finally {
    await cleanup();
  }
}
