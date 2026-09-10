export const UI_SOUND_PLAY_EVENT = "kaoz1:ui-sound:play";
export const UI_SOUND_SETTINGS_EVENT = "kaoz1:ui-sound:settings";
export const UI_SOUND_SETTINGS_KEY = "kaoz1:ui-sounds:v1";

export const UI_SOUND_SOURCES = {
  "app-open": "/sounds/neural-corrupted/app-open.wav",
  "task-complete": "/sounds/neural-corrupted/task-complete.wav",
  error: "/sounds/neural-corrupted/error.wav",
  attention: "/sounds/neural-corrupted/attention.wav",
  "mic-on": "/sounds/neural-corrupted/mic-on.wav",
  navigate: "/sounds/neural-corrupted/navigate.wav",
} as const;

export type UiSoundName = keyof typeof UI_SOUND_SOURCES;

export interface UiSoundPreferences {
  enabled: boolean;
  volume: number;
  playInBackground: boolean;
}

export interface UiSoundRequest {
  sound: UiSoundName;
  dedupeKey?: string;
  force?: boolean;
}

export const DEFAULT_UI_SOUND_PREFERENCES: UiSoundPreferences = {
  enabled: true,
  volume: 0.58,
  playInBackground: true,
};

export const UI_SOUND_DURATIONS_MS: Record<UiSoundName, number> = {
  "app-open": 1_620,
  "task-complete": 1_040,
  error: 690,
  attention: 820,
  "mic-on": 360,
  navigate: 170,
};

export function normalizeUiSoundPreferences(value: unknown): UiSoundPreferences {
  const source = value && typeof value === "object" ? value as Partial<UiSoundPreferences> : {};
  const rawVolume = typeof source.volume === "number" && Number.isFinite(source.volume)
    ? source.volume
    : DEFAULT_UI_SOUND_PREFERENCES.volume;

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_UI_SOUND_PREFERENCES.enabled,
    volume: Math.max(0, Math.min(1, rawVolume)),
    playInBackground: typeof source.playInBackground === "boolean"
      ? source.playInBackground
      : DEFAULT_UI_SOUND_PREFERENCES.playInBackground,
  };
}

export function readUiSoundPreferences(): UiSoundPreferences {
  if (typeof window === "undefined") return DEFAULT_UI_SOUND_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(UI_SOUND_SETTINGS_KEY);
    return normalizeUiSoundPreferences(stored ? JSON.parse(stored) : null);
  } catch {
    return DEFAULT_UI_SOUND_PREFERENCES;
  }
}

export function writeUiSoundPreferences(preferences: UiSoundPreferences): UiSoundPreferences {
  const normalized = normalizeUiSoundPreferences(preferences);
  if (typeof window === "undefined") return normalized;
  window.localStorage.setItem(UI_SOUND_SETTINGS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(UI_SOUND_SETTINGS_EVENT, { detail: normalized }));
  return normalized;
}

export function playUiSound(sound: UiSoundName, options: Omit<UiSoundRequest, "sound"> = {}): boolean {
  if (typeof window === "undefined") return false;
  const preferences = readUiSoundPreferences();
  if (!options.force && !preferences.enabled) return false;
  if (!options.force && document.hidden && !preferences.playInBackground) return false;

  window.dispatchEvent(new CustomEvent<UiSoundRequest>(UI_SOUND_PLAY_EVENT, {
    detail: { sound, ...options },
  }));
  return true;
}
