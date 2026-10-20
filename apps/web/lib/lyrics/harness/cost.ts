import { rates, type Rate } from "../../eval/cost";
import type { HarnessConfig } from "./harness";

/** Token profile of one 30 s Indic lyric (heavy tokenization). Assumed, not measured: recalibrate from the run's spend block. */
const LYRIC = 450, EXEMPLAR = 450, PLAYBOOK = 700, CRITIC_OUT = 350, JUDGE = { in: 1600, out: 260 };
const usd = (r: Rate, i: number, o: number) => (i * r.in + o * r.out) / 1e6;

/** Expected Claude USD per song for an arm, assuming every refinement round runs and is judged (the upper bound). */
export function estimateArmUsd(cfg: HarnessConfig, r = rates()): number {
  const s = r["claude-sonnet-5-5"]!;
  const ctx = cfg.exemplars * EXEMPLAR + (cfg.playbook ? PLAYBOOK : 0);
  const polish = usd(s, 400 + LYRIC + ctx, LYRIC);
  const round = usd(s, 500 + LYRIC + (cfg.playbook ? PLAYBOOK : 0), CRITIC_OUT) + usd(s, 500 + LYRIC + CRITIC_OUT, LYRIC) + (cfg.guard ? 2 * usd(s, JUDGE.in, JUDGE.out) : 0);
  const select = cfg.candidates > 1 ? usd(s, 300 + cfg.candidates * LYRIC, 60) : 0;
  return Math.round((cfg.candidates * (polish + cfg.rounds * round) + select) * 1000) / 1000;
}
