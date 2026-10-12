"use client";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import type { UiKey } from "@/lib/i18n/ui-strings";

/** Inline translated string for use from server components. */
export function T({ k }: { k: UiKey }) {
  const { t, lang } = useUiLang();
  return <span lang={lang}>{t(k)}</span>;
}
