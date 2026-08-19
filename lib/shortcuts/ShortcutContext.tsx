"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { SHORTCUT_DEFINITIONS, ShortcutActionId, ShortcutDefinition } from "./shortcut-definitions";
import { useHotkey } from "./use-hotkeys";

interface ShortcutContextValue {
  isCommandPaletteOpen: boolean;
  isCheatsheetOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  openCheatsheet: () => void;
  closeCheatsheet: () => void;
  toggleCheatsheet: () => void;
  registerActionHandler: (id: ShortcutActionId, handler: () => void) => () => void;
  triggerAction: (id: ShortcutActionId) => void;
  definitions: ShortcutDefinition[];
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isCheatsheetOpen, setIsCheatsheetOpen] = useState(false);

  const actionHandlers = useRef<Map<ShortcutActionId, () => void>>(new Map());

  const openCommandPalette = useCallback(() => setIsCommandPaletteOpen(true), []);
  const closeCommandPalette = useCallback(() => setIsCommandPaletteOpen(false), []);
  const toggleCommandPalette = useCallback(() => setIsCommandPaletteOpen((prev) => !prev), []);

  const openCheatsheet = useCallback(() => setIsCheatsheetOpen(true), []);
  const closeCheatsheet = useCallback(() => setIsCheatsheetOpen(false), []);
  const toggleCheatsheet = useCallback(() => setIsCheatsheetOpen((prev) => !prev), []);

  const registerActionHandler = useCallback((id: ShortcutActionId, handler: () => void) => {
    actionHandlers.current.set(id, handler);
    return () => {
      if (actionHandlers.current.get(id) === handler) {
        actionHandlers.current.delete(id);
      }
    };
  }, []);

  const triggerAction = useCallback((id: ShortcutActionId) => {
    const handler = actionHandlers.current.get(id);
    if (handler) {
      handler();
    }
  }, []);

  // Global hotkey: Ctrl+K / Cmd+K -> Command Palette
  useHotkey(["ctrl+k", "meta+k"], () => {
    toggleCommandPalette();
  }, { allowInInput: true });

  // Global hotkey: ? or Ctrl+/ -> Cheatsheet
  useHotkey(["?", "ctrl+/", "meta+/"], () => {
    if (!isCommandPaletteOpen) {
      toggleCheatsheet();
    }
  }, { allowInInput: false });

  // Global hotkey: Escape -> Close palette or cheatsheet
  useHotkey(["escape"], () => {
    if (isCommandPaletteOpen) {
      setIsCommandPaletteOpen(false);
    } else if (isCheatsheetOpen) {
      setIsCheatsheetOpen(false);
    }
  }, { allowInInput: true });

  return (
    <ShortcutContext.Provider
      value={{
        isCommandPaletteOpen,
        isCheatsheetOpen,
        openCommandPalette,
        closeCommandPalette,
        toggleCommandPalette,
        openCheatsheet,
        closeCheatsheet,
        toggleCheatsheet,
        registerActionHandler,
        triggerAction,
        definitions: SHORTCUT_DEFINITIONS,
      }}
    >
      {children}
    </ShortcutContext.Provider>
  );
}

export function useShortcuts() {
  const context = useContext(ShortcutContext);
  if (!context) {
    throw new Error("useShortcuts must be used within a ShortcutProvider");
  }
  return context;
}
