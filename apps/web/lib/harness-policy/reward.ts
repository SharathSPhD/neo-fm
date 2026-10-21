/**
 * Reward for one finished song, from the listener events that already exist (feedback_events, apps/web/lib/personalization/taste.ts).
 * 1 = clearly liked, 0 = clearly rejected, 0.5 = no signal. Same signs as the taste profile so the two never disagree.
 */
const SCORE: Record<string, number> = { like: 2, share: 2, download: 1.5, line_edit: 1.5, replay: 1, regenerate: -1, dislike: -2 };

export interface RewardEvent { kind: string; value?: number | null }

/** null when the song has no usable signal (it is not settled yet and does not move any posterior). */
export function songReward(events: RewardEvent[]): number | null {
  let net = 0;
  let n = 0;
  for (const e of events) {
    const s = e.kind === "play_pct" ? ((e.value ?? 0) >= 0.7 ? 1 : 0) : SCORE[e.kind] ?? 0;
    if (s === 0) continue;
    net += s;
    n += 1;
  }
  if (n === 0) return null;
  return Math.min(1, Math.max(0, 0.5 + net / 8));
}

/** Listener events are noisy and sparse next to a judge verdict, so one song counts for a fraction of a judged battle. */
export const LISTENER_WEIGHT = 0.2;
export const JUDGE_WEIGHT = 1;
