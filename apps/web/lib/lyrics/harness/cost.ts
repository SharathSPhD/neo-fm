import { rates, type Rate } from "../../eval/cost";
import type { HarnessConfig } from "./harness";

/** Token profile of one 30 s Indic lyric. LYRIC is calibrated so a plain polish costs about USD 0.05, the measured production figure (2026-10-20 baseline run); the rest scale from it. Recalibrate from each run's spend block. */
const EDIT_OUT = 900, LYRIC = 2700, EXEMPLAR = 1500, PLAYBOOK = 1500, CRITIC_OUT = 600, JUDGE = { in: 2400, out: 400 };
const usd = (r: Rate, i: number, o: number) => (i * r.in + o * r.out) / 1e6;

/** Expected Claude USD per song for an arm, assuming every refinement round runs and is judged (the upper bound). */
export function estimateArmUsd(cfg: HarnessConfig, r = rates()): number {
  const s = r["claude-sonnet-5-5"]!;
  const ctx = cfg.exemplars * EXEMPLAR + (cfg.playbook ? PLAYBOOK : 0);
  const polish = usd(s, 400 + LYRIC + ctx, cfg.edits ? EDIT_OUT : LYRIC);
  const round = usd(s, 500 + LYRIC + (cfg.playbook ? PLAYBOOK : 0), CRITIC_OUT) + usd(s, 500 + LYRIC + CRITIC_OUT, LYRIC) + (cfg.guard ? 2 * usd(s, JUDGE.in, JUDGE.out) : 0);
  const select = cfg.candidates > 1 ? usd(s, 300 + cfg.candidates * LYRIC, 60) : 0;
  return Math.round((cfg.candidates * (polish + cfg.rounds * round) + select) * 1000) / 1000;
}
