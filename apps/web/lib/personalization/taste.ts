/**
 * Taste profile v1: a rules-based, decayed tally of what a listener keeps vs. discards. No ML, no embeddings,
 * nothing stored beyond weights per language/style (user-visible, user-deletable). Only computed with consent.
 */
export type SignalKind = "like" | "dislike" | "play_pct" | "replay" | "regenerate" | "share" | "download" | "line_edit";

export interface TasteSignal {
  kind: SignalKind;
  language: string;
  style: string;
  /** Milliseconds since the signal happened. */
  ageMs: number;
  value?: number | null;
}

export interface TasteProfile {
  weights: { language: Record<string, number>; style: Record<string, number> };
  nSignals: number;
}

const HALF_LIFE_MS = 45 * 86_400_000;

function score(s: TasteSignal): number {
  switch (s.kind) {
    case "like": return 2;
    case "share": return 2;
    case "download": return 1.5;
    case "line_edit": return 1.5; // the strongest "this is mine" signal: they cared enough to edit
    case "replay": return 1;
    case "play_pct": return (s.value ?? 0) >= 0.7 ? 1 : 0;
    case "regenerate": return -1;
    case "dislike": return -2;
    default: return 0;
  }
}

export function computeTaste(signals: TasteSignal[], _now = Date.now()): TasteProfile {
  const language: Record<string, number> = {};
  const style: Record<string, number> = {};
  let n = 0;
  for (const s of signals) {
    const base = score(s);
    if (base === 0) continue;
    n += 1;
    const w = base * Math.pow(0.5, Math.max(0, s.ageMs) / HALF_LIFE_MS);
    language[s.language] = (language[s.language] ?? 0) + w;
    style[s.style] = (style[s.style] ?? 0) + w;
  }
  return { weights: { language, style }, nSignals: n };
}

const top = (m: Record<string, number>, k: number, positive: boolean) =>
  Object.entries(m)
    .filter(([, v]) => (positive ? v > 0.5 : v < -0.5))
    .sort((a, b) => (positive ? b[1] - a[1] : a[1] - b[1]))
    .slice(0, k)
    .map(([key]) => key);

/** A tiny, human-readable card for the Producer's context (never silent: the user can see and delete the source). */
export function userCard(t: TasteProfile): string {
  const langs = top(t.weights.language, 3, true);
  const styles = top(t.weights.style, 3, true);
  const avoid = top(t.weights.style, 2, false);
  if (langs.length === 0 && styles.length === 0 && avoid.length === 0) return "";
  const parts = [] as string[];
  if (langs.length) parts.push(`often enjoys ${langs.join(", ")}`);
  if (styles.length) parts.push(`favours ${styles.join(", ")}`);
  if (avoid.length) parts.push(`tends to discard ${avoid.join(", ")}`);
  return `Listener taste (opt-in, derived from their own likes/plays): ${parts.join("; ")}. Use only to choose between equally valid creative options; never override the brief.`;
}
