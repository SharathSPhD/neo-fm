"use client";

import { useRouter } from "next/navigation";
import { createContext, createElement, useCallback, useContext, useSyncExternalStore } from "react";

import {
  isUiLang,
  translate,
  UI_LANG_COOKIE,
  type UiKey,
  type UiLang,
  type UiVars,
} from "./ui-strings";

const CHANGE_EVENT = "neo-fm:ui-lang-change";

/** Server-resolved language (cookie or Accept-Language), so first paint matches. */
const InitialLangContext = createContext<UiLang>("en");

export function UiLangProvider({ initial, children }: { initial: UiLang; children: React.ReactNode }) {
  return createElement(InitialLangContext.Provider, { value: initial }, children);
}

function readCookie(): UiLang | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${UI_LANG_COOKIE}=([^;]*)`));
  const v = m ? decodeURIComponent(m[1]!) : null;
  return isUiLang(v) ? v : null;
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

/**
 * UI language. Persisted in a cookie (so server components render in the
 * same language) and defaulted from the browser's Accept-Language by the
 * server when nothing is saved.
 */
export function useUiLang() {
  const initial = useContext(InitialLangContext);
  const router = useRouter();
  const lang = useSyncExternalStore(subscribe, () => readCookie() ?? initial, () => initial);

  const setLang = useCallback(
    (next: UiLang) => {
      document.cookie = `${UI_LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      window.dispatchEvent(new Event(CHANGE_EVENT));
      // Re-render server components in the new language.
      router.refresh();
    },
    [router],
  );

  const t = useCallback((key: UiKey, vars?: UiVars) => translate(lang, key, vars), [lang]);
  return { lang, setLang, t };
}
