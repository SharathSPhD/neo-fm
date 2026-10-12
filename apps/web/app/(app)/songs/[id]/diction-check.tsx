import { serverI18n } from "@/lib/i18n/server";

type Qa = { matchPct?: number; flagged?: { line: string; heard: string; cer: number }[]; error?: string } | null;

/** Post-render pronunciation check (Gemini listened to the song and compared it with the lyrics). */
export async function DictionCheck({ qa }: { qa: Qa }) {
  if (!qa || qa.matchPct === undefined) return null;
  const { t } = await serverI18n();
  const tone = qa.matchPct >= 85 ? "text-emerald-300" : qa.matchPct >= 70 ? "text-amber-200" : "text-red-300";
  return (
    <section aria-labelledby="diction-h" className="rounded-lg border border-muted/20 p-4 text-sm">
      <h2 id="diction-h" className="flex items-center gap-2 font-medium">
        {t("songact.diction.title")} <span className={`text-xs ${tone}`}>{t("songact.diction.match", { pct: qa.matchPct })}</span>
      </h2>
      <p className="mt-1 text-xs text-foreground/55">{t("songact.diction.note")}</p>
      {qa.flagged && qa.flagged.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-foreground/70">{qa.flagged.length === 1 ? t("songact.diction.one") : t("songact.diction.many", { n: qa.flagged.length })}</summary>
          <ul className="mt-2 space-y-1 text-xs text-foreground/70">
            {qa.flagged.slice(0, 6).map((f) => (
              <li key={f.line}>“{f.line}”</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
