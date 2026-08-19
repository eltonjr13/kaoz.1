"use client";

import { useEffect, useRef } from "react";
import { eventToKeyCombo, isEditableElement, normalizeKeyCombo } from "./shortcut-definitions";

export interface HotkeyOptions {
  allowInInput?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  enabled?: boolean;
}

export function useHotkey(
  keyCombo: string | string[],
  callback: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {}
) {
  const {
    allowInInput = false,
    preventDefault = true,
    stopPropagation = false,
    enabled = true,
  } = options;

  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const combos = Array.isArray(keyCombo) ? keyCombo : [keyCombo];
  const normalizedCombos = combos.map(normalizeKeyCombo);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!allowInInput && isEditableElement(event.target)) {
        return;
      }

      const currentCombo = eventToKeyCombo(event);
      const isMatch = normalizedCombos.includes(currentCombo);

      if (isMatch) {
        if (preventDefault) {
          event.preventDefault();
        }
        if (stopPropagation) {
          event.stopPropagation();
        }
        callbackRef.current(event);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, allowInInput, preventDefault, stopPropagation, normalizedCombos.join(",")]);
}
