"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_UI_SOUND_PREFERENCES,
  normalizeUiSoundPreferences,
  playUiSound,
  readUiSoundPreferences,
  UI_SOUND_PLAY_EVENT,
  UI_SOUND_SETTINGS_EVENT,
  UI_SOUND_SOURCES,
  type UiSoundName,
  type UiSoundPreferences,
  type UiSoundRequest,
} from "@/lib/ui-sounds";

const INTRO_PLAYED_KEY = "kaoz1:ui-sound:intro-played";
const MAX_DEDUPE_KEYS = 250;
const PRIORITY: Record<UiSoundName, number> = {
  navigate: 1,
  "mic-on": 3,
  attention: 4,
  "task-complete": 4,
  error: 5,
  "app-open": 5,
};
const SOUND_GAIN: Record<UiSoundName, number> = {
  navigate: 0.58,
  "mic-on": 0.74,
  attention: 0.78,
  "task-complete": 0.86,
  error: 0.82,
  "app-open": 0.88,
};
const COOLDOWN_MS: Record<UiSoundName, number> = {
  navigate: 90,
  "mic-on": 250,
  attention: 900,
  "task-complete": 500,
  error: 500,
  "app-open": 2_000,
};

interface ActiveSound {
  audio: HTMLAudioElement;
  priority: number;
}

function preferencesAllowRequest(request: UiSoundRequest, preferences: UiSoundPreferences) {
  if (request.force) return true;
  if (!preferences.enabled) return false;
  if (!document.hidden) return true;
  return preferences.playInBackground;
}

function activeSoundAllowsRequest(
  request: UiSoundRequest,
  active: ActiveSound | null,
  requestedPriority: number,
) {
  if (request.force) return true;
  if (!active) return true;
  if (active.audio.ended) return true;
  return requestedPriority >= active.priority;
}

function stopActiveSound(active: ActiveSound | null, nextAudio: HTMLAudioElement | undefined) {
  if (!active) return;
  if (active.audio === nextAudio) return;
  if (active.audio.ended) return;
  active.audio.pause();
  active.audio.currentTime = 0;
}

function requestWasPlayed(request: UiSoundRequest, keys: Set<string>) {
  if (!request.dedupeKey) return false;
  return keys.has(request.dedupeKey);
}

function requestIsCoolingDown(request: UiSoundRequest, playedAt: Map<UiSoundName, number>) {
  if (request.force) return false;
  const lastPlayed = playedAt.get(request.sound) || 0;
  return Date.now() - lastPlayed < COOLDOWN_MS[request.sound];
}

function rememberRequest(request: UiSoundRequest, keys: Set<string>) {
  if (request.dedupeKey) rememberDedupeKey(keys, request.dedupeKey);
}

function clearActiveSound(active: ActiveSound | null, audio: HTMLAudioElement) {
  if (active?.audio === audio) return null;
  return active;
}

function rememberDedupeKey(keys: Set<string>, key: string) {
  keys.add(key);
  if (keys.size <= MAX_DEDUPE_KEYS) return;
  const oldest = keys.values().next().value;
  if (oldest) keys.delete(oldest);
}

export function UiSoundProvider() {
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);
  const playersRef = useRef<Map<UiSoundName, HTMLAudioElement>>(new Map());
  const preferencesRef = useRef<UiSoundPreferences>(DEFAULT_UI_SOUND_PREFERENCES);
  const activeRef = useRef<ActiveSound | null>(null);
  const playedAtRef = useRef<Map<UiSoundName, number>>(new Map());
  const dedupeKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    preferencesRef.current = readUiSoundPreferences();
    const players = new Map<UiSoundName, HTMLAudioElement>();
    for (const [sound, source] of Object.entries(UI_SOUND_SOURCES) as [UiSoundName, string][]) {
      const audio = new Audio(source);
      audio.preload = "auto";
      players.set(sound, audio);
    }
    playersRef.current = players;

    const performPlay = async (request: UiSoundRequest): Promise<boolean> => {
      const preferences = preferencesRef.current;
      if (!preferencesAllowRequest(request, preferences)) return false;
      if (requestWasPlayed(request, dedupeKeysRef.current)) return false;
      if (requestIsCoolingDown(request, playedAtRef.current)) return false;

      const priority = PRIORITY[request.sound];
      const active = activeRef.current;
      const audio = players.get(request.sound);
      if (!activeSoundAllowsRequest(request, active, priority)) return false;
      if (!audio) return false;
      stopActiveSound(active, audio);
      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.max(0, Math.min(1, preferences.volume * SOUND_GAIN[request.sound]));
      activeRef.current = { audio, priority };
      try {
        await audio.play();
        playedAtRef.current.set(request.sound, Date.now());
        rememberRequest(request, dedupeKeysRef.current);
        return true;
      } catch {
        activeRef.current = clearActiveSound(activeRef.current, audio);
        return false;
      }
    };

    const handlePlay = (event: Event) => {
      const request = (event as CustomEvent<UiSoundRequest>).detail;
      if (request?.sound in UI_SOUND_SOURCES) void performPlay(request);
    };
    const handleSettings = (event: Event) => {
      preferencesRef.current = normalizeUiSoundPreferences(
        (event as CustomEvent<UiSoundPreferences>).detail,
      );
    };
    window.addEventListener(UI_SOUND_PLAY_EVENT, handlePlay);
    window.addEventListener(UI_SOUND_SETTINGS_EVENT, handleSettings);

    let removeIntroUnlock = () => undefined;
    if (!window.sessionStorage.getItem(INTRO_PLAYED_KEY) && preferencesRef.current.enabled) {
      const attemptIntro = async () => {
        const played = await performPlay({ sound: "app-open", dedupeKey: "session:intro" });
        if (played) {
          window.sessionStorage.setItem(INTRO_PLAYED_KEY, "true");
          removeIntroUnlock();
        }
      };
      const unlockIntro = () => void attemptIntro();
      document.addEventListener("pointerdown", unlockIntro, true);
      document.addEventListener("keydown", unlockIntro, true);
      removeIntroUnlock = () => {
        document.removeEventListener("pointerdown", unlockIntro, true);
        document.removeEventListener("keydown", unlockIntro, true);
      };
      void attemptIntro();
    }

    return () => {
      removeIntroUnlock();
      window.removeEventListener(UI_SOUND_PLAY_EVENT, handlePlay);
      window.removeEventListener(UI_SOUND_SETTINGS_EVENT, handleSettings);
      players.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      playersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    playUiSound("navigate");
  }, [pathname]);

  return null;
}
