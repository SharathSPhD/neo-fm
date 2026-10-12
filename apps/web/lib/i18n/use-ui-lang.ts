"use client";

import { useCallback, useSyncExternalStore } from "react";

import { isUiLang, translate, type UiKey, type UiLang } from "./ui-strings";

const STORAGE_KEY = "neo-fm:ui-lang";
const CHANGE_EVENT = "neo-fm:ui-lang-change";

function read(): UiLang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isUiLang(v) ? v : "en";
  } catch {
    // Storage blocked (private mode): fall back to English.
    return "en";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * UI language for the key flows. Persisted per browser; the server
 * snapshot is always English so hydration never mismatches.
 */
export function useUiLang() {
  const lang = useSyncExternalStore(subscribe, read, () => "en" as UiLang);

  const setLang = useCallback((next: UiLang) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best effort
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const t = useCallback((key: UiKey) => translate(lang, key), [lang]);
  return { lang, setLang, t };
}
