import { serverI18n } from "@/lib/i18n/server";
import type { UiKey } from "@/lib/i18n/ui-strings";

const SUMMARY_KEYS: Record<"terms" | "privacy", readonly UiKey[]> = {
  terms: ["legal.terms.s1", "legal.terms.s2", "legal.terms.s3", "legal.terms.s4", "legal.terms.s5"],
  privacy: ["legal.privacy.s1", "legal.privacy.s2", "legal.privacy.s3", "legal.privacy.s4", "legal.privacy.s5"],
};

/**
 * Plain-language summary shown above the English legal text, in the
 * reader's UI language. It is a convenience: the English text governs.
 */
export async function LegalSummary({ kind }: { kind: "terms" | "privacy" }) {
  const { t, lang } = await serverI18n();
  return (
    <aside aria-labelledby={`${kind}-summary`} className="mt-8 rounded-xl border border-accent/30 bg-accent/5 p-5" lang={lang}>
      <h2 id={`${kind}-summary`} className="text-lg font-medium">
        {t("legal.summaryTitle")}
      </h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-foreground/80">
        {SUMMARY_KEYS[kind].map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-foreground/60">{t("legal.summaryNote")}</p>
    </aside>
  );
}
