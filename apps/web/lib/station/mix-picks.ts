/**
 * The listener's language mix for the Station pass: up to three languages, each "less", "even" or "more" of the airtime.
 * Sent as percentages, `langs=ta:60,hi:40` (the queue normalises the weights, lib/station/lang-mix.ts); fewer than two picks is not a mix.
 */
export const MAX_MIX = 3;
export const WEIGHTS = [1, 2, 3] as const;
export type MixWeight = (typeof WEIGHTS)[number];
export interface MixPick { lang: string; weight: MixWeight }

const isWeight = (w: unknown): w is MixWeight => w === 1 || w === 2 || w === 3;

/** Add a language at even weight, or remove it when already picked; a fourth pick drops the oldest. */
export function toggleMixLang(picks: readonly MixPick[], lang: string): MixPick[] {
  if (picks.some((p) => p.lang === lang)) return picks.filter((p) => p.lang !== lang);
  return [...picks, { lang, weight: 2 as MixWeight }].slice(-MAX_MIX);
}

export function setMixWeight(picks: readonly MixPick[], lang: string, weight: MixWeight): MixPick[] {
  return picks.map((p) => (p.lang === lang ? { ...p, weight } : p));
}

export function mixActive(picks: readonly MixPick[]): boolean {
  return picks.length >= 2;
}

/** The `langs` query value, or null when the picks are not a mix. */
export function mixParam(picks: readonly MixPick[]): string | null {
  if (!mixActive(picks)) return null;
  const total = picks.reduce((n, p) => n + p.weight, 0);
  return picks.map((p) => `${p.lang}:${Math.round((100 * p.weight) / total)}`).join(",");
}

/** Saved picks from storage: only offered languages, valid weights, no duplicates, at most MAX_MIX. */
export function cleanMix(raw: unknown, offered: readonly string[]): MixPick[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MixPick[] = [];
  for (const v of raw) {
    const p = v as { lang?: unknown; weight?: unknown } | null;
    if (!p || typeof p.lang !== "string" || !p.lang || seen.has(p.lang) || !offered.includes(p.lang) || !isWeight(p.weight)) continue;
    seen.add(p.lang);
    out.push({ lang: p.lang, weight: p.weight });
    if (out.length === MAX_MIX) break;
  }
  return out;
}
