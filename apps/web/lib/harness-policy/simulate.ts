import { mulberry32 } from "./bandit";
import { pickArm, type PolicyRow, type StatRow } from "./policy";

/** Offline replay of the policy: the real pickArm, fed rewards drawn from recorded judge scores. No database, no model calls. */
export interface SimInput {
  rows: PolicyRow[];
  /** recorded rewards in [0,1] per arm (judge win 1, tie 0.5, loss 0); a draw is a bootstrap resample */
  rewards: Record<string, number[]>;
  jobs: number;
  language?: string;
  tier?: string;
  seed?: number;
  /** policy off or table unreadable: the answer must be the flag arm throughout */
  env?: Record<string, string | undefined>;
  tastePrior?: Record<string, number>;
  /** fixed number of leading jobs from one listener whose own stats are kept apart from the language posterior */
  listener?: boolean;
}

export interface SimResult {
  share: Record<string, number>;
  /** share over the final fifth of jobs */
  lateShare: Record<string, number>;
  /** first job index after which the leader's rolling-200 share stays >= 0.6, or null */
  convergedAt: number | null;
  sources: Record<string, number>;
  /** posterior means after the run */
  means: Record<string, number>;
}

export function simulate(i: SimInput): SimResult {
  const language = i.language ?? "kn";
  const tier = i.tier ?? "creator";
  const rng = mulberry32(i.seed ?? 1);
  const env = i.env ?? { HARNESS_POLICY: "1" };
  const g = new Map<string, StatRow>();
  const u = new Map<string, StatRow>();
  const count: Record<string, number> = {};
  const late: Record<string, number> = {};
  const sources: Record<string, number> = {};
  const picks: string[] = [];
  const lateFrom = Math.floor(i.jobs * 0.8);
  for (let j = 0; j < i.jobs; j++) {
    const p = pickArm({ env, language, tier, rows: i.rows, global: [...g.values()], user: i.listener ? [...u.values()] : [], tastePrior: i.tastePrior, seed: (rng() * 2 ** 32) >>> 0 });
    sources[p.source] = (sources[p.source] ?? 0) + 1;
    const id = p.arm.id;
    picks.push(id);
    count[id] = (count[id] ?? 0) + 1;
    if (j >= lateFrom) late[id] = (late[id] ?? 0) + 1;
    const pool = i.rewards[id];
    if (!pool?.length) continue;
    const r = pool[Math.floor(rng() * pool.length)]!;
    for (const m of i.listener ? [g, u] : [g]) {
      const s = m.get(id) ?? { arm_id: id, a: 1, b: 1 };
      m.set(id, { arm_id: id, a: s.a + r, b: s.b + 1 - r });
    }
  }
  const norm = (c: Record<string, number>, n: number) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / n]));
  const lead = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
  let convergedAt: number | null = null;
  if (lead) {
    let streakFrom: number | null = null;
    for (let j = 199; j < picks.length; j++) {
      let c = 0;
      for (let k = j - 199; k <= j; k++) if (picks[k] === lead) c++;
      if (c / 200 >= 0.6) { if (streakFrom === null) streakFrom = j; } else streakFrom = null;
    }
    convergedAt = streakFrom;
  }
  return {
    share: norm(count, i.jobs),
    lateShare: norm(late, i.jobs - lateFrom),
    convergedAt,
    sources,
    means: Object.fromEntries([...g.values()].map((s) => [s.arm_id, s.a / (s.a + s.b)])),
  };
}

/** Recorded battles of one challenger vs the champion, per language, as challenger-side rewards. Champion's own reward is 0.5 by definition. */
export function rewardsFromBattles(lines: string[], challenger: string, champion: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const l of lines) {
    if (!l.trim()) continue;
    const x = JSON.parse(l) as { kind: string; a: string; b: string; brief: string; score: number };
    if (x.kind !== "lyrics") continue;
    const r = x.a === challenger && x.b === champion ? x.score : x.a === champion && x.b === challenger ? 1 - x.score : null;
    if (r === null) continue;
    (out[x.brief.split("-")[0]!] ??= []).push(r);
  }
  return out;
}
