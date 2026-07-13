import * as React from "react";
import { createSpeechProvider, type SpeechProvider, type SpeechProviderStatus } from "./providers";
import { acquireMicrophoneSession } from "./microphone-session";

interface UseSpeechDictationInput {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

function combineDictationText(baseText: string, transcript: string): string {
  return [baseText.trimEnd(), transcript.trim()].filter(Boolean).join(" ");
}

function getFriendlySpeechError(error: Error): string {
  return error.message || "Nao foi possivel transcrever o audio.";
}

export function useSpeechDictation({ value, onValueChange, disabled = false }: UseSpeechDictationInput) {
  const [status, setStatus] = React.useState<SpeechProviderStatus>("idle");
  const [error, setError] = React.useState("");
  const [transcript, setTranscript] = React.useState("");
  const providerRef = React.useRef<SpeechProvider | null>(null);
  const baseTextRef = React.useRef("");
  const releaseMicrophoneRef = React.useRef<(() => void) | null>(null);

  const stop = React.useCallback(async () => {
    const provider = providerRef.current;
    providerRef.current = null;
    try {
      await provider?.stop();
    } finally {
      releaseMicrophoneRef.current?.();
      releaseMicrophoneRef.current = null;
      setStatus("idle");
    }
  }, []);

  const start = React.useCallback(async () => {
    if (disabled || status !== "idle") return false;

    let microphoneSession: ReturnType<typeof acquireMicrophoneSession>;
    try {
      microphoneSession = acquireMicrophoneSession();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "O microfone ja esta em uso.");
      return false;
    }

    const provider = createSpeechProvider();
    providerRef.current = provider;
    releaseMicrophoneRef.current = microphoneSession.release;
    baseTextRef.current = value;
    setError("");
    setTranscript("");

    provider.onTranscript((nextTranscript) => {
      setTranscript(nextTranscript);
      onValueChange(combineDictationText(baseTextRef.current, nextTranscript));
    });
    provider.onError((nextError) => {
      setError(getFriendlySpeechError(nextError));
      void stop();
    });
    provider.onStatus(setStatus);

    try {
      await provider.start();
      return true;
    } catch (nextError) {
      providerRef.current = null;
      releaseMicrophoneRef.current?.();
      releaseMicrophoneRef.current = null;
      setStatus("idle");
      setError(nextError instanceof Error ? getFriendlySpeechError(nextError) : "Nao foi possivel iniciar o microfone.");
      return false;
    }
  }, [disabled, onValueChange, status, stop, value]);

  React.useEffect(() => {
    return () => {
      void providerRef.current?.stop();
      providerRef.current = null;
      releaseMicrophoneRef.current?.();
      releaseMicrophoneRef.current = null;
    };
  }, []);

  return {
    error,
    isRecording: status === "recording" || status === "sending",
    isSending: status === "sending",
    start,
    status,
    stop,
    transcript,
  };
}
