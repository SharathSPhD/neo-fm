/**
 * /insights -- creator insights for the signed-in user's own songs: plays, likes and shares over time, listener
 * languages and the best song this week. Everything comes from aggregate-only SECURITY DEFINER functions
 * (migration 0078) that filter on auth.uid(); nothing per-listener is ever readable.
 */
import { redirect } from "next/navigation";

import { languageLabel } from "@/lib/insights/listen";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DAYS = 30;

type DailyRow = { job_id: string; title: string | null; day: string; plays: number; likes: number; shares: number };
type LangRow = { lang: string; plays: number };
type BestRow = { job_id: string; title: string | null; plays: number; likes: number; shares: number; score: number };

function lastDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export default async function InsightsPage() {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/sign-in?next=/insights");

  const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  const [daily, langs, best] = await Promise.all([
    rpc("creator_insights_daily", { p_days: DAYS }),
    rpc("creator_top_languages", { p_days: DAYS }),
    rpc("creator_best_song_week"),
  ]);
  const rows = ((daily.data ?? []) as DailyRow[]).map((r) => ({ ...r, plays: Number(r.plays), likes: Number(r.likes), shares: Number(r.shares) }));
  const languages = ((langs.data ?? []) as LangRow[]).map((r) => ({ lang: r.lang, plays: Number(r.plays) }));
  const top = ((best.data ?? []) as BestRow[])[0];

  const days = lastDays(DAYS);
  const songs = new Map<string, { title: string; plays: number; likes: number; shares: number; byDay: Map<string, number> }>();
  for (const r of rows) {
    const s = songs.get(r.job_id) ?? { title: r.title?.trim() || "Untitled song", plays: 0, likes: 0, shares: 0, byDay: new Map() };
    s.plays += r.plays; s.likes += r.likes; s.shares += r.shares;
    s.byDay.set(r.day, (s.byDay.get(r.day) ?? 0) + r.plays);
    songs.set(r.job_id, s);
  }
  const list = [...songs.entries()].sort((a, b) => b[1].plays + b[1].likes - (a[1].plays + a[1].likes));
  const totals = list.reduce((t, [, s]) => ({ plays: t.plays + s.plays, likes: t.likes + s.likes, shares: t.shares + s.shares }), { plays: 0, likes: 0, shares: 0 });
  const maxLang = Math.max(1, ...languages.map((l) => l.plays));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-1 text-sm text-foreground/60">How your published songs did in the last {DAYS} days. Only totals are shown; we never see who listened.</p>
      </header>

      {list.length === 0 && !top ? (
        <section data-testid="insights-empty" className="rounded-lg border border-muted/20 bg-muted/5 p-6 text-sm text-foreground/70">
          No plays or likes yet. Publish a song from its page and share the link; counts show up here as people listen.
        </section>
      ) : (
        <>
          <section aria-label="Totals" className="grid grid-cols-3 gap-3">
            {([["Plays", totals.plays], ["Likes", totals.likes], ["Shares", totals.shares]] as const).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-muted/20 bg-muted/5 p-4">
                <p className="text-xs uppercase tracking-wide text-foreground/50">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{n}</p>
              </div>
            ))}
          </section>

          {top ? (
            <section data-testid="insights-best" className="rounded-lg border border-accent/40 bg-accent/10 p-4">
              <p className="text-xs uppercase tracking-wide text-foreground/60">Best song this week</p>
              <p className="mt-1 text-lg font-medium">{top.title?.trim() || "Untitled song"}</p>
              <p className="text-sm text-foreground/70">{Number(top.plays)} plays · {Number(top.likes)} likes · {Number(top.shares)} shares</p>
            </section>
          ) : null}

          <section aria-label="Per song">
            <h2 className="mb-3 text-lg font-medium">By song</h2>
            <ul className="flex flex-col gap-3">
              {list.map(([id, s]) => {
                const peak = Math.max(1, ...days.map((d) => s.byDay.get(d) ?? 0));
                return (
                  <li key={id} className="rounded-lg border border-muted/20 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <a href={`/songs/${id}`} className="font-medium underline-offset-2 hover:underline">{s.title}</a>
                      <span className="text-xs text-foreground/60">{s.plays} plays · {s.likes} likes · {s.shares} shares</span>
                    </div>
                    <div className="mt-3 flex h-10 items-end gap-px" role="img" aria-label={`Plays per day over the last ${DAYS} days for ${s.title}`}>
                      {days.map((d) => {
                        const v = s.byDay.get(d) ?? 0;
                        return <span key={d} title={`${d}: ${v}`} className={"flex-1 rounded-sm " + (v ? "bg-accent" : "bg-muted/20")} style={{ height: `${v ? Math.max(12, (v / peak) * 100) : 6}%` }} />;
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <section aria-label="Listener languages" data-testid="insights-languages">
        <h2 className="mb-3 text-lg font-medium">Listener languages</h2>
        {languages.length ? (
          <ul className="flex flex-col gap-2">
            {languages.map((l) => (
              <li key={l.lang} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0">{languageLabel(l.lang)}</span>
                <span className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(4, (l.plays / maxLang) * 100)}%` }} />
                <span className="text-foreground/60">{l.plays}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground/60">Languages appear once your songs have at least 5 plays, so no single listener can be picked out.</p>
        )}
      </section>
    </main>
  );
}
