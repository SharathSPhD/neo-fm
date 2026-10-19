"use client";

import { UI_LANGS, UI_LANG_ENDONYM, TRANSLATION_STATUS, type UiLang } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

/**
 * UI language picker. Writes the language cookie, so the choice sticks
 * across visits and server-rendered pages follow it.
 */
export function LanguageSwitcher({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { lang, setLang, t } = useUiLang();
  const pending = TRANSLATION_STATUS[lang] === "pending-review";
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs text-foreground/70 ${className}`}>
      <span className="sr-only">{t("lang.label")}</span>
      <span aria-hidden className={compact ? "hidden min-[400px]:inline" : undefined}>🌐</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as UiLang)}
        title={pending ? t("lang.pendingReview") : undefined}
        className={`min-h-[44px] rounded-md border border-muted/40 bg-transparent py-1 text-sm text-foreground sm:min-h-[36px] ${compact ? "px-1 min-[400px]:px-2" : "px-2"}`}
      >
        {UI_LANGS.map((l) => (
          <option key={l} value={l} lang={l} className="bg-background">
            {UI_LANG_ENDONYM[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
