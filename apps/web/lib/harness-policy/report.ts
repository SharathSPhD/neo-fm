import { mean } from "./bandit";

export interface StatIn { language: string; tier: string; arm_id: string; a: number; b: number }
export interface ChoiceIn { language: string; tier: string; arm_id: string; source: string; settled_at: string | null; reward: number | null }

export interface ArmReport {
  language: string; tier: string; arm_id: string;
  /** posterior mean win rate vs the champion and a rough 90% interval (normal approximation) */
  mean: number; low: number; high: number;
  /** effective observations behind the posterior (prior excluded) */
  n: number;
  /** songs given this arm in the window, and the share of that language and tier's songs */
  songs: number; share: number;
  viaPolicy: number; settled: number; avgReward: number | null;
}

/** Joins posteriors with the arm each recent job was given, for the admin view. Pure; the route supplies the rows. */
export function armReport(stats: StatIn[], choices: ChoiceIn[]): ArmReport[] {
  const key = (l: string, t: string, a: string) => `${l}|${t}|${a}`;
  const groups = new Map<string, ArmReport>();
  const get = (l: string, t: string, a: string): ArmReport => {
    const k = key(l, t, a);
    let r = groups.get(k);
    if (!r) { r = { language: l, tier: t, arm_id: a, mean: 0.5, low: 0.5, high: 0.5, n: 0, songs: 0, share: 0, viaPolicy: 0, settled: 0, avgReward: null }; groups.set(k, r); }
    return r;
  };
  for (const s of stats) {
    const r = get(s.language, s.tier, s.arm_id);
    const tot = s.a + s.b;
    const m = mean({ a: s.a, b: s.b });
    const sd = Math.sqrt((m * (1 - m)) / (tot + 1));
    r.mean = m; r.low = Math.max(0, m - 1.645 * sd); r.high = Math.min(1, m + 1.645 * sd); r.n = Math.max(0, tot - 2);
  }
  const rewardSum = new Map<string, number>();
  for (const c of choices) {
    const r = get(c.language, c.tier, c.arm_id);
    r.songs += 1;
    if (c.source === "policy") r.viaPolicy += 1;
    if (c.settled_at && c.reward !== null) { r.settled += 1; rewardSum.set(key(c.language, c.tier, c.arm_id), (rewardSum.get(key(c.language, c.tier, c.arm_id)) ?? 0) + Number(c.reward)); }
  }
  const total = new Map<string, number>();
  for (const r of groups.values()) total.set(`${r.language}|${r.tier}`, (total.get(`${r.language}|${r.tier}`) ?? 0) + r.songs);
  for (const r of groups.values()) {
    const t = total.get(`${r.language}|${r.tier}`) ?? 0;
    r.share = t ? r.songs / t : 0;
    r.avgReward = r.settled ? (rewardSum.get(key(r.language, r.tier, r.arm_id)) ?? 0) / r.settled : null;
  }
  return [...groups.values()].sort((x, y) => x.language.localeCompare(y.language) || x.tier.localeCompare(y.tier) || y.songs - x.songs);
}
