"use client";

import { useEffect, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  playUiSound,
  readUiSoundPreferences,
  UI_SOUND_SETTINGS_EVENT,
  writeUiSoundPreferences,
  type UiSoundName,
  type UiSoundPreferences,
} from "@/lib/ui-sounds";

const PREVIEWS: { sound: UiSoundName; label: string }[] = [
  { sound: "app-open", label: "Abertura" },
  { sound: "task-complete", label: "Conclusão" },
  { sound: "attention", label: "Atenção" },
  { sound: "error", label: "Erro" },
  { sound: "mic-on", label: "Microfone" },
  { sound: "navigate", label: "Navegação" },
];

export function SoundSettingsPanel() {
  const [preferences, setPreferences] = useState<UiSoundPreferences>(() => readUiSoundPreferences());

  useEffect(() => {
    const handleSettings = (event: Event) => {
      setPreferences((event as CustomEvent<UiSoundPreferences>).detail);
    };
    window.addEventListener(UI_SOUND_SETTINGS_EVENT, handleSettings);
    return () => window.removeEventListener(UI_SOUND_SETTINGS_EVENT, handleSettings);
  }, []);

  const updatePreferences = (patch: Partial<UiSoundPreferences>) => {
    setPreferences(writeUiSoundPreferences({ ...preferences, ...patch }));
  };

  return (
    <section className="rounded-[16px] border border-white/5 bg-[#111114] p-5 sm:p-6">
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-400">
              {preferences.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-200">Identidade sonora</h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">Neural Corrompido · sons originais do Kaoz.1</p>
            </div>
          </div>
          <ToggleSwitch
            checked={preferences.enabled}
            onChange={(enabled) => updatePreferences({ enabled })}
            size="md"
            ariaLabel="Ativar sons da interface"
          />
        </div>

        <div className="grid gap-4 border-t border-white/[0.05] pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block">
            <span className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <span>Volume</span>
              <span>{Math.round(preferences.volume * 100)}%</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(preferences.volume * 100)}
              onChange={(event) => updatePreferences({ volume: Number(event.target.value) / 100 })}
              className="h-1.5 w-full cursor-pointer accent-violet-500"
              aria-label="Volume dos sons da interface"
            />
          </label>
          <ToggleSwitch
            checked={preferences.playInBackground}
            onChange={(playInBackground) => updatePreferences({ playInBackground })}
            label="Sons em segundo plano"
            description="Avisar quando uma tarefa terminar com a janela oculta"
            switchPosition="right"
            className="min-w-[260px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-white/[0.05] pt-4 sm:grid-cols-3">
          {PREVIEWS.map(({ sound, label }) => (
            <button
              key={sound}
              type="button"
              onClick={() => playUiSound(sound, { force: true })}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-[10px] font-semibold text-zinc-300 transition-colors hover:border-violet-500/25 hover:bg-violet-500/[0.08] hover:text-white"
            >
              <Play size={11} fill="currentColor" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
