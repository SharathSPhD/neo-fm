"use client";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import type { UiKey, UiVars } from "@/lib/i18n/ui-strings";

/** Inline translated string for client trees and server components alike. */
export function T({ k, vars }: { k: UiKey; vars?: UiVars }) {
  const { t, lang } = useUiLang();
  return <span lang={lang}>{t(k, vars)}</span>;
}
