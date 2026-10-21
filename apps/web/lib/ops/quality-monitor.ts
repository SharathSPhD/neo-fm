/**
 * Prod quality monitor: scores every finished song in a window by day, language, tier and harness arm.
 * Pure aggregation plus one read-only loader; nothing here writes or spends. Lyrics get the free structural metrics below
 * (a TypeScript subset of tools/lyrics-lab/bench/lyricmetrics.py: no meter or rhyme terms), diction comes from the Gemini
 * score already stored on the run (agent_runs.diction_qa), and arm / refs ids come from job_telemetry.metrics.quality
 * (written by the render step, see process.ts). Rows scored before that field existed show up under arm "unknown".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { detectScript, lineProsody, type Script } from "../diction";
import { singableLines } from "../lyrics/singable";

export interface RunQuality {
  tier?: string;
  arm?: string;
  source?: string;
  premium?: boolean;
  refs_ids?: string[];
  roman?: "used" | "fallback" | "off";
}

export interface QualityRow {
  day: string;
  language: string;
  quality: RunQuality | null;
  lyrics: string | null;
  matchPct: number | null;
  unorderedPct: number | null;
  verdict: string | null;
  /** Advisory local-ASR order-free match (diction_qa.local), present only when DICTION_LOCAL_PREFILTER ran. */
  localPct?: number | null;
}

export interface LyricMetrics { lines: number; scriptShare: number; uniqRatio: number; meanAksharas: number }

const EXPECTED: Record<string, Script> = {
  kn: "kannada", kannada: "kannada", hi: "devanagari", hindi: "devanagari", mr: "devanagari", marathi: "devanagari",
  ta: "tamil", tamil: "tamil", te: "telugu", telugu: "telugu", bn: "bengali", bengali: "bengali", ml: "malayalam", malayalam: "malayalam",
  pa: "gurmukhi", punjabi: "gurmukhi", gu: "gujarati", gujarati: "gujarati",
};

/** Cheap structure signals on the written lyrics. scriptShare is the share of letters in the language's own script. */
export function lyricMetrics(lyrics: string, language: string): LyricMetrics {
  const lines = singableLines(lyrics);
  const norm = (l: string) => l.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const uniq = new Set(lines.map(norm)).size;
  const want = EXPECTED[language.toLowerCase()];
  const letters = Array.from(lyrics).filter((c) => /\p{L}/u.test(c));
  const inScript = want ? letters.filter((c) => detectScript(c) === want).length : 0;
  const counts = lines.map((l) => lineProsody(l).count);
  return {
    lines: lines.length,
    scriptShare: letters.length && want ? inScript / letters.length : 0,
    uniqRatio: lines.length ? uniq / lines.length : 0,
    meanAksharas: counts.length ? counts.reduce((s, x) => s + x, 0) / counts.length : 0,
  };
}

/** One label per run: the polish arm, with the other live levers appended. Unrecorded runs are "unknown". */
export function armLabel(q: RunQuality | null): string {
  if (!q || !q.arm) return "unknown";
  return [q.arm, q.roman === "used" ? "roman" : q.roman === "fallback" ? "roman-fallback" : ""].filter(Boolean).join("+");
}

export interface QualityGroup {
  day: string;
  language: string;
  tier: string;
  arm: string;
  n: number;
  lyrics_n: number;
  avg_script_share: number | null;
  avg_uniq_ratio: number | null;
  avg_lines: number | null;
  avg_aksharas: number | null;
  diction_n: number;
  avg_match_pct: number | null;
  avg_unordered_pct: number | null;
  under80_share: number | null;
  local_n: number;
  avg_local_pct: number | null;
}

const mean = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000 : null);

export interface QualitySummary {
  generated_at: string;
  window_days: number;
  rows: number;
  /** Share of runs that carry the quality meta (arm, tier, refs ids); older runs predate it. */
  meta_coverage: number;
  groups: QualityGroup[];
  /** How often each exemplar rode along, by language: the raw material for pruning the refs pool. */
  refs_usage: Record<string, Record<string, number>>;
}

export function summarizeQuality(rows: QualityRow[], windowDays: number, now = new Date()): QualitySummary {
  const by = new Map<string, QualityRow[]>();
  const refs: Record<string, Record<string, number>> = {};
  let withMeta = 0;
  for (const r of rows) {
    if (r.quality?.arm) withMeta++;
    const key = [r.day, r.language, r.quality?.tier ?? "unknown", armLabel(r.quality)].join("|");
    (by.get(key) ?? by.set(key, []).get(key)!).push(r);
    for (const id of r.quality?.refs_ids ?? []) {
      const m = (refs[r.language] ??= {});
      m[id] = (m[id] ?? 0) + 1;
    }
  }
  const groups: QualityGroup[] = [];
  for (const [key, rs] of by) {
    const [day, language, tier, arm] = key.split("|") as [string, string, string, string];
    const lm = rs.filter((r) => r.lyrics).map((r) => lyricMetrics(r.lyrics!, language));
    const match = rs.map((r) => r.matchPct).filter((x): x is number => typeof x === "number");
    const unord = rs.map((r) => r.unorderedPct ?? r.matchPct).filter((x): x is number => typeof x === "number");
    const local = rs.map((r) => r.localPct).filter((x): x is number => typeof x === "number");
    groups.push({
      day, language, tier, arm, n: rs.length, lyrics_n: lm.length,
      avg_script_share: mean(lm.map((x) => x.scriptShare)), avg_uniq_ratio: mean(lm.map((x) => x.uniqRatio)),
      avg_lines: mean(lm.map((x) => x.lines)), avg_aksharas: mean(lm.map((x) => x.meanAksharas)),
      diction_n: match.length, avg_match_pct: mean(match), avg_unordered_pct: mean(unord),
      under80_share: unord.length ? Math.round((unord.filter((x) => x < 80).length / unord.length) * 1000) / 1000 : null,
      local_n: local.length, avg_local_pct: mean(local),
    });
  }
  groups.sort((a, b) => b.day.localeCompare(a.day) || a.language.localeCompare(b.language) || a.tier.localeCompare(b.tier) || a.arm.localeCompare(b.arm));
  return { generated_at: now.toISOString(), window_days: windowDays, rows: rows.length, meta_coverage: rows.length ? Math.round((withMeta / rows.length) * 1000) / 1000 : 0, groups, refs_usage: refs };
}

const CAP = 2000;

/** Read-only: finished runs in the window with their telemetry meta, stored lyrics and stored Gemini diction score. */
export async function loadQualityRows(db: SupabaseClient, days: number): Promise<{ rows: QualityRow[]; truncated: boolean }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const runs = await db.from("agent_runs")
    .select("job_id,updated_at,lyrics,polished_lyrics,diction_qa,jobs(status,song_documents(language))")
    .gte("updated_at", since).order("updated_at", { ascending: false }).limit(CAP);
  if (runs.error) throw new Error(runs.error.message);
  type Run = { job_id: string; updated_at: string; lyrics: string | null; polished_lyrics: string | null; diction_qa: { matchPct?: number; unorderedPct?: number; verdict?: string; local?: { unorderedPct?: number } } | null; jobs: { status?: string; song_documents: { language: string } | null } | null };
  const data = ((runs.data ?? []) as unknown as Run[]).filter((r) => r.jobs?.status === "completed" && r.jobs.song_documents?.language);
  const tel = data.length
    ? await db.from("job_telemetry").select("job_id,metrics").in("job_id", data.map((r) => r.job_id))
    : { data: [] as { job_id: string; metrics: { quality?: RunQuality } | null }[], error: null };
  if (tel.error) throw new Error(tel.error.message);
  const meta = new Map((tel.data ?? []).map((t) => [String(t.job_id), (t.metrics as { quality?: RunQuality } | null)?.quality ?? null]));
  const rows: QualityRow[] = data.map((r) => ({
    day: r.updated_at.slice(0, 10), language: r.jobs!.song_documents!.language, quality: meta.get(r.job_id) ?? null,
    lyrics: r.polished_lyrics ?? r.lyrics, matchPct: r.diction_qa?.matchPct ?? null, unorderedPct: r.diction_qa?.unorderedPct ?? null, verdict: r.diction_qa?.verdict ?? null, localPct: r.diction_qa?.local?.unorderedPct ?? null,
  }));
  return { rows, truncated: (runs.data?.length ?? 0) >= CAP };
}
