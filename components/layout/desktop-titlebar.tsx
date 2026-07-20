"use client";

import { Copy, Minus, Sparkles, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

export function DesktopTitlebar() {
  const [desktop, setDesktop] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const bridge = window.mrChickenDesktop;
    if (!bridge) return;

    document.documentElement.dataset.mrchickenDesktop = "true";
    setDesktop(true);
    void bridge.isMaximized().then(setMaximized);
    return bridge.onMaximizedChanged(setMaximized);
  }, []);

  if (!desktop) return null;

  const bridge = window.mrChickenDesktop;
  if (!bridge) return null;

  return (
    <header className="mrchicken-desktop-titlebar" aria-label="Controles da janela do MrChicken">
      <div className="mrchicken-desktop-titlebar__brand">
        <Sparkles size={13} aria-hidden="true" />
        <span>MrChicken</span>
      </div>
      <div
        className="mrchicken-desktop-titlebar__drag-region"
        aria-hidden="true"
        onDoubleClick={() => void bridge.toggleMaximize()}
      />
      <div className="mrchicken-desktop-titlebar__controls">
        <button type="button" aria-label="Minimizar" title="Minimizar" onClick={() => void bridge.minimize()}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restaurar" : "Maximizar"}
          title={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => void bridge.toggleMaximize()}
        >
          {maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
        </button>
        <button type="button" className="mrchicken-desktop-titlebar__close" aria-label="Fechar" title="Fechar" onClick={() => void bridge.close()}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
