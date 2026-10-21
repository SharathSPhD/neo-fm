import { OPUS_POLISH_MODEL } from "./polish";

const PAID_TIERS = new Set(["creator", "pro", "developer"]);

/**
 * PCE_PREMIUM_POLISH (comma list of language codes, e.g. "kn,hi"): paid tiers get the Opus 5.5 polish with corpus refs
 * (lyrics-lab arm refs_opus; beat live Sonnet polish 19-2-2 Claude / 21-2-0 Gemini on 23 kn/hi cases). Free stays on Sonnet.
 * Off by default; unset the variable to fall back.
 */
export function premiumPolishModel(env: Record<string, string | undefined>, tier: string | null | undefined, langCode: string): string | undefined {
  if (!tier || !PAID_TIERS.has(tier)) return undefined;
  const langs = (env.PCE_PREMIUM_POLISH ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return langs.includes(langCode.toLowerCase()) ? OPUS_POLISH_MODEL : undefined;
}
