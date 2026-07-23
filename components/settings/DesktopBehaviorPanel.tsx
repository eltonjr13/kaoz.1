"use client";

import { useEffect, useState } from "react";
import { AppWindow, Loader2 } from "lucide-react";

export function DesktopBehaviorPanel() {
  const bridge = typeof window === "undefined" ? undefined : window.kaoz1Desktop;
  const [closeToTray, setCloseToTray] = useState(true);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getDesktopPreferences()
      .then((preferences) => {
        if (preferences) setCloseToTray(preferences.closeToTray);
      })
      .finally(() => setLoading(false));
  }, [bridge]);

  const toggleCloseToTray = async () => {
    if (!bridge || saving) return;
    const next = !closeToTray;
    setCloseToTray(next);
    setSaving(true);
    try {
      const saved = await bridge.setCloseToTray(next);
      if (saved) setCloseToTray(saved.closeToTray);
      else setCloseToTray(!next);
    } catch {
      setCloseToTray(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-[16px] border border-white/5 bg-[#111114] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-5">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-400">
            <AppWindow size={18} />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-200">Comportamento do aplicativo</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-500">
              Ao fechar a janela, mantenha o Kaoz.1 e seus conectores funcionando em segundo plano nos ícones ocultos do Windows.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={closeToTray}
          aria-label="Fechar para os ícones ocultos"
          onClick={() => void toggleCloseToTray()}
          disabled={!bridge || loading || saving}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${closeToTray ? "bg-emerald-500" : "bg-zinc-700"}`}
        >
          <span className={`absolute top-1 flex size-4 items-center justify-center rounded-full bg-white shadow transition-transform ${closeToTray ? "translate-x-6" : "translate-x-1"}`}>
            {(loading || saving) && <Loader2 size={10} className="animate-spin text-zinc-700" />}
          </span>
        </button>
      </div>

      <div className="mt-5 border-t border-white/[0.05] pt-4 text-[10px] text-zinc-500">
        <span className="font-semibold text-zinc-300">Fechar para os ícones ocultos: </span>
        {!bridge ? "disponível somente no aplicativo para Windows" : closeToTray ? "ativado" : "desativado; o botão X encerrará o aplicativo"}.
      </div>
    </section>
  );
}
