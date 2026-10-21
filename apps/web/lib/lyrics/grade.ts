/**
 * Lyric grades for personal songs: Standard (live pipeline), Premium (Opus polish with corpus refs, lib/lyrics/premium.ts)
 * and Studio (the same Opus path today; the 3-Opus-draft stage joins once the `full_opus` arm passes its gate).
 * Plan and numbers: strategy/premium-lyrics-tier.md section 10. Off unless LYRIC_GRADES=1.
 *
 * Each tier has a monthly allowance; a paid add-on (+INR 29 Premium, +INR 99 Studio) tops it up. A song spends one
 * allowance credit first, then one add-on credit. Spending is atomic in the database (migration 0115); when the migration is
 * not applied, or anything errors, the song simply stays Standard.
 */
import type { UserTier } from "../agent/tiers";
import { OPUS_POLISH_MODEL } from "./polish";

type Env = Record<string, string | undefined>;

export type LyricGrade = "standard" | "premium" | "studio";
export type PaidGrade = Exclude<LyricGrade, "standard">;
export const PAID_GRADES: readonly PaidGrade[] = ["premium", "studio"];

export const lyricGradesEnabled = (env: Env = process.env): boolean => env.LYRIC_GRADES === "1";

/** Languages the Opus grades are evidenced for (kn, hi head-to-head, 23 cases). `LYRIC_GRADE_LANGS` widens it. */
export function gradeLangs(env: Env = process.env): string[] {
  const raw = env.LYRIC_GRADE_LANGS;
  const list = (raw === undefined ? "kn,hi" : raw).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list;
}

/** Monthly personal-song allowance per tier. Creator: one Premium. Pro: six Premium and two Studio. Free: none (add-ons only). */
export const TIER_GRADE_ALLOWANCE: Record<UserTier, Record<PaidGrade, number>> = {
  free: { premium: 0, studio: 0 },
  creator: { premium: 1, studio: 0 },
  pro: { premium: 6, studio: 2 },
  developer: { premium: 30, studio: 10 },
};

/** Add-on products: one extra song of the grade per purchase. Price points are working INR figures (stripe-setup route). */
export const ADDON_SONGS: Record<PaidGrade, number> = { premium: 1, studio: 1 };

export interface GradeBalance {
  /** Allowance credits used this calendar month (UTC). */
  allowanceUsed: Record<PaidGrade, number>;
  /** Add-on credits bought and not yet spent. */
  addonLeft: Record<PaidGrade, number>;
}

export const EMPTY_BALANCE: GradeBalance = {
  allowanceUsed: { premium: 0, studio: 0 },
  addonLeft: { premium: 0, studio: 0 },
};

export interface GradeLeft {
  allowance: number;
  addon: number;
  total: number;
}

export function gradeLeft(tier: UserTier, grade: PaidGrade, bal: GradeBalance): GradeLeft {
  const allowance = Math.max(0, TIER_GRADE_ALLOWANCE[tier][grade] - bal.allowanceUsed[grade]);
  const addon = Math.max(0, bal.addonLeft[grade]);
  return { allowance, addon, total: allowance + addon };
}

/**
 * The grade a request gets. An explicit request is honoured only when a credit exists; Studio falls back to Premium, then
 * Standard (the caller reports which). With no request, a listener with Premium credit left gets Premium, so the monthly
 * allowance is used without a picker; Studio is always an explicit choice.
 */
export function resolveGrade(
  tier: UserTier,
  requested: LyricGrade | undefined,
  langCode: string,
  bal: GradeBalance,
  env: Env = process.env,
): LyricGrade {
  if (!lyricGradesEnabled(env) || !gradeLangs(env).includes(langCode.toLowerCase())) return "standard";
  const want: LyricGrade = requested ?? "premium";
  if (want === "studio" && gradeLeft(tier, "studio", bal).total > 0) return "studio";
  if ((want === "studio" || want === "premium") && gradeLeft(tier, "premium", bal).total > 0) return "premium";
  return "standard";
}

/** The polish model a graded song uses; undefined keeps the live Sonnet polish. */
export function modelForGrade(grade: LyricGrade | undefined): string | undefined {
  return grade === "premium" || grade === "studio" ? OPUS_POLISH_MODEL : undefined;
}

/** Narrow whatever the document metadata carries to a grade; anything unknown is Standard. */
export function gradeFromMetadata(metadata: unknown): LyricGrade {
  const g = (metadata as { lyric_grade?: unknown } | null | undefined)?.lyric_grade;
  return g === "premium" || g === "studio" ? g : "standard";
}

// ---- station blend (share of pool tracks per grade, strategy 10.2) -----------------------------------------------------

export interface GradeMix {
  standard: number;
  premium: number;
  studio: number;
}

/** Share of tracks per listening hour, by tier. The Station pass listens like Creator. Shares sum to 1. */
export const TIER_BLEND: Record<UserTier, GradeMix> = {
  free: { standard: 0.85, premium: 0.15, studio: 0 },
  creator: { standard: 0.75, premium: 0.25, studio: 0 },
  pro: { standard: 0.6, premium: 0.3, studio: 0.1 },
  developer: { standard: 0.6, premium: 0.3, studio: 0.1 },
};

export function blendFor(tier: UserTier | null | undefined, hasPass = false): GradeMix {
  if (tier === "pro" || tier === "developer") return TIER_BLEND[tier];
  if (hasPass || tier === "creator") return TIER_BLEND.creator;
  return TIER_BLEND.free;
}

/**
 * Whether a track of `grade` may play next given the recent grades (oldest first) and the mix: a soft share over the window.
 * A grade with a zero share never plays; Standard always may, so a thin pool falls back to rank order. A paid grade is held
 * back once its share of the window (counting this track) would exceed the mix by more than one track.
 */
export function gradeAllowed(grade: LyricGrade, played: readonly LyricGrade[], mix: GradeMix): boolean {
  if (grade === "standard") return true;
  if (mix[grade] <= 0) return false;
  const n = played.length + 1;
  const same = played.filter((g) => g === grade).length + 1;
  return same <= Math.ceil(mix[grade] * n);
}

// ---- ledger (migration 0115); every call degrades to "no credit" ----------------------------------------------------------

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** Start of the calendar month in UTC, the allowance window. */
export function monthStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function readGradeBalance(db: unknown, userId: string, now: Date = new Date()): Promise<GradeBalance> {
  try {
    const { data, error } = await (db as Rpc).rpc("lyric_grade_state", { p_user_id: userId, p_since: monthStartUtc(now) });
    if (error || !Array.isArray(data)) return EMPTY_BALANCE;
    const bal: GradeBalance = { allowanceUsed: { premium: 0, studio: 0 }, addonLeft: { premium: 0, studio: 0 } };
    for (const row of data as { grade?: string; allowance_used?: number; addon_left?: number }[]) {
      if (row.grade !== "premium" && row.grade !== "studio") continue;
      bal.allowanceUsed[row.grade] = Number(row.allowance_used ?? 0);
      bal.addonLeft[row.grade] = Number(row.addon_left ?? 0);
    }
    return bal;
  } catch {
    return EMPTY_BALANCE;
  }
}

/**
 * Spends one credit of `grade`, allowance first. `ref` makes it idempotent (a retry of the same request spends once).
 * Returns the source charged, or null when there is no credit or the database cannot say.
 */
export async function spendGrade(
  db: unknown,
  userId: string,
  tier: UserTier,
  grade: PaidGrade,
  ref: string,
  now: Date = new Date(),
): Promise<"allowance" | "addon" | null> {
  try {
    const { data, error } = await (db as Rpc).rpc("spend_lyric_grade", {
      p_user_id: userId,
      p_grade: grade,
      p_allowance: TIER_GRADE_ALLOWANCE[tier][grade],
      p_since: monthStartUtc(now),
      p_ref: ref,
    });
    return !error && (data === "allowance" || data === "addon") ? data : null;
  } catch {
    return null;
  }
}

/** Gives the credit back when the job could not be created. Best effort. */
export async function refundGrade(db: unknown, userId: string, ref: string): Promise<void> {
  try {
    await (db as Rpc).rpc("refund_lyric_grade", { p_user_id: userId, p_ref: ref });
  } catch {
    /* a lost refund costs the listener one credit; the ledger row names the ref for support */
  }
}
