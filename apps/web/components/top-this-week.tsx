import Link from "next/link";

import { loadChart } from "@/lib/charts/load";
import { CHART_LANGS } from "@/lib/charts/pick";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

/**
 * "Top this week" per language. `lang` null = all languages. Chips are
 * plain links (`?chart=kn`) so the page stays server-rendered and cacheable.
 */
export async function TopThisWeek({ lang }: { lang: string | null }) {
  const chart = await loadChart(lang, 7, 10);
  return (
    <section aria-labelledby="top-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="top-heading" className="text-lg font-medium">
          Top this week
        </h2>
        <nav aria-label="Chart language" className="flex flex-wrap gap-1.5 text-xs">
          {[{ v: null, label: "All" }, ...CHART_LANGS.map((v) => ({ v, label: prettyLanguage(v) }))].map(
            (o) => (
              <Link
                key={o.v ?? "all"}
                href={o.v ? `/discover?chart=${o.v}` : "/discover"}
                aria-current={o.v === lang ? "true" : undefined}
                className={`rounded-full border px-2.5 py-1 ${
                  o.v === lang
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-muted/30 text-foreground/60 hover:border-accent/50"
                }`}
              >
                {o.label}
              </Link>
            ),
          )}
        </nav>
      </div>
      {chart.length === 0 ? (
        <p className="text-sm text-foreground/50">
          No chart yet{lang ? ` for ${prettyLanguage(lang)}` : ""}. Songs rank once a few listeners
          have liked, finished or shared them this week.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-muted/15 rounded-lg border border-muted/20">
          {chart.map((s, i) => (
            <li key={s.public_id}>
              <Link
                href={`/s/${s.public_id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <span className="w-6 text-right text-sm tabular-nums text-foreground/40">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.title || "Untitled"}</span>
                  <span className="text-xs text-foreground/60">
                    {prettyLanguage(s.language)} · {prettyStyle(s.style_family)}
                  </span>
                </span>
                <span className="text-xs text-foreground/50">
                  {s.likes > 0 ? `♥ ${s.likes}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
