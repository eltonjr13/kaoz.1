"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { acquireMicrophoneSession } from "@/lib/speech/microphone-session";
import { WebSpeechProvider } from "@/lib/speech/providers/webspeech-provider";
import type { MeetingSession } from "@/lib/meeting-notes/meeting-notes-store";

type CaptureState = "idle" | "starting" | "recording" | "pausing" | "stopping";

interface MeetingNotesContextValue {
  activeSession: MeetingSession | null;
  captureState: CaptureState;
  preview: string;
  error: string;
  pendingCount: number;
  start: (session?: MeetingSession, title?: string) => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  clearError: () => void;
}

const MeetingNotesContext = createContext<MeetingNotesContextValue | null>(null);
const CHUNK_MS = 8_000;

function runtime(): "desktop" | "web" {
  return typeof window !== "undefined" && window.kaoz1Desktop ? "desktop" : "web";
}

function responseError(payload: unknown, fallback: string): string {
  return typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function canStop(state: CaptureState): boolean {
  return state === "recording";
}

function stoppingState(status: "paused" | "stopped"): CaptureState {
  return status === "paused" ? "pausing" : "stopping";
}

async function createSession(title?: string): Promise<MeetingSession> {
  const response = await fetch("/api/meeting-notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: title || "Nova reunião" }),
  });
  const payload = await response.json().catch(() => ({})) as { session?: MeetingSession; error?: string };
  if (!response.ok || !payload.session) throw new Error(responseError(payload, "Falha ao criar reunião."));
  return payload.session;
}

async function updateSessionStatus(id: string, status: "recording" | "paused" | "stopped"): Promise<MeetingSession> {
  const response = await fetch(`/api/meeting-notes/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const payload = await response.json().catch(() => ({})) as { session?: MeetingSession; error?: string };
  if (!response.ok || !payload.session) throw new Error(responseError(payload, "Falha ao atualizar a reunião."));
  return payload.session;
}

async function shouldUseWebSpeech(): Promise<boolean> {
  const response = await fetch("/api/speech/config", { cache: "no-store" });
  const config = await response.json().catch(() => ({})) as { provider?: string };
  return config.provider === "webspeech" && runtime() === "web" &&
    typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

export function MeetingNotesProvider({ children }: { children: React.ReactNode }) {
  const [activeSession, setActiveSession] = useState<MeetingSession | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const stateRef = useRef<CaptureState>("idle");
  const sessionRef = useRef<MeetingSession | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderStopRef = useRef<Promise<void> | null>(null);
  const recognitionRef = useRef<WebSpeechProvider | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const captureEpochRef = useRef(0);
  const offsetMsRef = useRef(0);
  const chunkStartMsRef = useRef(0);
  const lastFinalTextRef = useRef("");
  const lastFinalEndMsRef = useRef(0);

  const transition = (value: CaptureState) => {
    stateRef.current = value;
    setCaptureState(value);
  };

  const setSession = (session: MeetingSession) => {
    sessionRef.current = session;
    setActiveSession(session);
  };

  const elapsed = () => offsetMsRef.current + Math.max(0, Date.now() - captureEpochRef.current);

  const queueUpload = useCallback((work: () => Promise<void>) => {
    setPendingCount((count) => count + 1);
    sendQueueRef.current = sendQueueRef.current.catch(() => undefined).then(async () => {
      try {
        await work();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falha ao salvar a transcrição.");
        const id = sessionRef.current?.id;
        if (id) {
          const response = await fetch(`/api/meeting-notes/${id}`, { cache: "no-store" }).catch(() => null);
          if (response?.ok) {
            const payload = await response.json().catch(() => ({})) as { session?: MeetingSession };
            if (payload.session) setSession(payload.session);
          }
        }
      } finally {
        setPendingCount((count) => Math.max(0, count - 1));
      }
    });
  }, []);

  const uploadText = useCallback((sessionId: string, text: string, startMs: number, endMs: number) => {
    if (!text.trim()) return;
    const chunkId = crypto.randomUUID();
    queueUpload(async () => {
      const response = await fetch(`/api/meeting-notes/${sessionId}/segments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chunkId, text, startMs, endMs }),
      });
      const payload = await response.json().catch(() => ({})) as { session?: MeetingSession; error?: string };
      if (!response.ok) throw new Error(responseError(payload, "Falha ao salvar trecho."));
      if (payload.session) setSession(payload.session);
    });
  }, [queueUpload]);

  const uploadAudio = useCallback((sessionId: string, audio: Blob, startMs: number, endMs: number) => {
    if (audio.size === 0) return;
    const chunkId = crypto.randomUUID();
    queueUpload(async () => {
      const form = new FormData();
      form.set("audio", audio, `${chunkId}.webm`);
      form.set("chunkId", chunkId);
      form.set("startMs", String(startMs));
      form.set("endMs", String(endMs));
      form.set("runtime", runtime());
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch(`/api/meeting-notes/${sessionId}/segments`, { method: "POST", body: form });
          break;
        } catch {
          if (attempt === 1) throw new Error("Áudio não enviado. Mantenha a reunião aberta e tente novamente.");
        }
      }
      const payload = await response!.json().catch(() => ({})) as { session?: MeetingSession; error?: string };
      if (!response!.ok) throw new Error(responseError(payload, "Falha ao transcrever trecho. O áudio pode ser reprocessado na reunião."));
      if (payload.session) setSession(payload.session);
    });
  }, [queueUpload]);

  const beginRecorder = useCallback((sessionId: string) => {
    const stream = streamRef.current;
    if (!stream || stateRef.current !== "recording") return;
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const parts: Blob[] = [];
    recorderRef.current = recorder;
    chunkStartMsRef.current = elapsed();
    recorder.ondataavailable = (event) => {
      if (event.data.size) parts.push(event.data);
    };
    recorder.onerror = () => setError("Falha ao capturar áudio do microfone.");
    recorder.onstop = () => {
      const endMs = elapsed();
      const blob = new Blob(parts, { type: recorder.mimeType || mime || "audio/webm" });
      if (blob.size && endMs > chunkStartMsRef.current) uploadAudio(sessionId, blob, chunkStartMsRef.current, endMs);
      recorderRef.current = null;
      recorderStopRef.current = null;
      if (stateRef.current === "recording" && stream.active) beginRecorder(sessionId);
    };
    recorder.start();
    recorderTimerRef.current = setTimeout(() => {
      recorderTimerRef.current = null;
      if (recorder.state !== "inactive") recorder.stop();
    }, CHUNK_MS);
  }, [uploadAudio]);

  const finishRecorder = async () => {
    if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
    recorderTimerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
      recorderStopRef.current = stopped;
      recorder.stop();
      await stopped;
    } else if (recorderStopRef.current) {
      await recorderStopRef.current;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stopCapture = async (status: "paused" | "stopped") => {
    const session = sessionRef.current;
    if (!session || !canStop(stateRef.current)) return;
    transition(stoppingState(status));
    try {
      await recognitionRef.current?.stop();
      recognitionRef.current = null;
      await finishRecorder();
      const finalElapsed = elapsed();
      await sendQueueRef.current;
      setSession(await updateSessionStatus(session.id, status));
      offsetMsRef.current = finalElapsed;
      setPreview("");
    } catch (cause) {
      setError(errorMessage(cause, "Falha ao interromper a gravação."));
    } finally {
      releaseRef.current?.();
      releaseRef.current = null;
      transition("idle");
    }
  };

  const beginWebSpeech = async (session: MeetingSession) => {
    const recognition = new WebSpeechProvider();
    recognition.onTranscript((text, isFinal) => {
      const previous = lastFinalTextRef.current;
      setPreview(text.startsWith(previous) ? text.slice(previous.length).trim() : text);
      if (!isFinal || !text.trim()) return;
      const addition = text.startsWith(previous) ? text.slice(previous.length).trim() : "";
      if (!addition) return;
      const endMs = elapsed();
      uploadText(session.id, addition, lastFinalEndMsRef.current, endMs);
      lastFinalTextRef.current = text;
      lastFinalEndMsRef.current = endMs;
      setPreview("");
    });
    recognition.onError((cause) => setError(cause.message));
    recognition.onStatus((status) => {
      if (status === "idle" && stateRef.current === "recording") {
        setError("O reconhecimento de voz foi interrompido. Retome para continuar a reunião.");
        void stopCapture("paused");
      }
    });
    await recognition.start();
    recognitionRef.current = recognition;
  };

  const beginMediaCapture = async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Captura de áudio indisponível neste ambiente.");
    }
    streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  };

  const start = async (existing?: MeetingSession, title?: string) => {
    if (stateRef.current !== "idle") return;
    transition("starting");
    setError("");
    try {
      releaseRef.current = acquireMicrophoneSession().release;
      const session = existing ?? await createSession(title);
      if (session.status === "stopped") throw new Error("Esta reunião já foi encerrada.");
      setSession(session);
      offsetMsRef.current = session.segments.reduce((max, segment) => Math.max(max, segment.endMs), 0);
      captureEpochRef.current = Date.now();
      lastFinalEndMsRef.current = offsetMsRef.current;
      lastFinalTextRef.current = "";
      if (await shouldUseWebSpeech()) await beginWebSpeech(session);
      else await beginMediaCapture();
      setSession(await updateSessionStatus(session.id, "recording"));
      transition("recording");
      beginRecorder(session.id);
    } catch (cause) {
      setError(errorMessage(cause, "Falha ao iniciar gravação."));
      recognitionRef.current?.stop().catch(() => undefined);
      recognitionRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      releaseRef.current?.();
      releaseRef.current = null;
      transition("idle");
    }
  };

  // DashboardLayout persists across Next.js route changes. The browser window
  // stays mounted when Electron's close-to-tray preference hides it.
  useEffect(() => () => {
    if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void recognitionRef.current?.stop();
    releaseRef.current?.();
  }, []);

  return (
    <MeetingNotesContext.Provider value={{
      activeSession, captureState, preview, error, pendingCount, start,
      pause: () => stopCapture("paused"),
      stop: () => stopCapture("stopped"),
      clearError: () => setError(""),
    }}>
      {children}
    </MeetingNotesContext.Provider>
  );
}

export function useMeetingNotes(): MeetingNotesContextValue {
  const context = useContext(MeetingNotesContext);
  if (!context) throw new Error("MeetingNotesProvider não encontrado.");
  return context;
}
