import { describe, expect, it } from "vitest";
import {
  EMPTY_BALANCE, TIER_BLEND, TIER_GRADE_ALLOWANCE, blendFor, gradeAllowed, gradeFromMetadata, gradeLeft, modelForGrade,
  monthStartUtc, readGradeBalance, refundGrade, resolveGrade, spendGrade, type GradeBalance,
} from "../lib/lyrics/grade";

const on = { LYRIC_GRADES: "1" };
const bal = (p: Partial<GradeBalance["allowanceUsed"]> = {}, a: Partial<GradeBalance["addonLeft"]> = {}): GradeBalance => ({
  allowanceUsed: { premium: 0, studio: 0, ...p },
  addonLeft: { premium: 0, studio: 0, ...a },
});

describe("resolveGrade", () => {
  it("is Standard when the flag is off or the language has no evidence", () => {
    expect(resolveGrade("pro", "studio", "kn", EMPTY_BALANCE, {})).toBe("standard");
    expect(resolveGrade("pro", "studio", "ta", EMPTY_BALANCE, on)).toBe("standard");
    expect(resolveGrade("pro", "premium", "ta", EMPTY_BALANCE, { ...on, LYRIC_GRADE_LANGS: "kn,hi,ta" })).toBe("premium");
  });
  it("gives an unrequested song Premium while credit lasts, never Studio", () => {
    expect(resolveGrade("pro", undefined, "hi", EMPTY_BALANCE, on)).toBe("premium");
    expect(resolveGrade("creator", undefined, "kn", bal({ premium: 1 }), on)).toBe("standard");
  });
  it("honours Studio only against Studio credit and falls back to Premium then Standard", () => {
    expect(resolveGrade("pro", "studio", "kn", EMPTY_BALANCE, on)).toBe("studio");
    expect(resolveGrade("pro", "studio", "kn", bal({ studio: 2 }), on)).toBe("premium");
    expect(resolveGrade("pro", "studio", "kn", bal({ studio: 2, premium: 6 }), on)).toBe("standard");
    expect(resolveGrade("creator", "studio", "kn", EMPTY_BALANCE, on)).toBe("premium");
  });
  it("Free has no allowance but an add-on credit works", () => {
    expect(resolveGrade("free", "premium", "kn", EMPTY_BALANCE, on)).toBe("standard");
    expect(resolveGrade("free", "premium", "kn", bal({}, { premium: 1 }), on)).toBe("premium");
  });
});

describe("gradeLeft", () => {
  it("adds the allowance remaining to add-on credit and never goes negative", () => {
    expect(gradeLeft("pro", "premium", bal({ premium: 4 }, { premium: 2 }))).toEqual({ allowance: 2, addon: 2, total: 4 });
    expect(gradeLeft("creator", "premium", bal({ premium: 5 }))).toEqual({ allowance: 0, addon: 0, total: 0 });
    expect(TIER_GRADE_ALLOWANCE.creator.studio).toBe(0);
  });
});

describe("model and metadata", () => {
  it("only graded songs get Opus", () => {
    expect(modelForGrade("premium")).toBe("claude-opus-5-5");
    expect(modelForGrade("studio")).toBe("claude-opus-5-5");
    expect(modelForGrade("standard")).toBeUndefined();
    expect(modelForGrade(undefined)).toBeUndefined();
  });
  it("reads the granted grade from metadata and treats anything else as Standard", () => {
    expect(gradeFromMetadata({ lyric_grade: "studio" })).toBe("studio");
    expect(gradeFromMetadata({ lyric_grade: "gold" })).toBe("standard");
    expect(gradeFromMetadata(undefined)).toBe("standard");
  });
});

describe("blend", () => {
  it("shares sum to 1 and match the plan", () => {
    for (const mix of Object.values(TIER_BLEND)) expect(mix.standard + mix.premium + mix.studio).toBeCloseTo(1);
    expect(TIER_BLEND.free).toEqual({ standard: 0.85, premium: 0.15, studio: 0 });
    expect(TIER_BLEND.creator).toEqual({ standard: 0.75, premium: 0.25, studio: 0 });
    expect(TIER_BLEND.pro).toEqual({ standard: 0.6, premium: 0.3, studio: 0.1 });
    expect(blendFor("free", true)).toEqual(TIER_BLEND.creator);
    expect(blendFor(null)).toEqual(TIER_BLEND.free);
  });
  it("holds paid grades to their share over the window and never lets a zero share play", () => {
    expect(gradeAllowed("studio", [], TIER_BLEND.free)).toBe(false);
    expect(gradeAllowed("standard", ["standard"], TIER_BLEND.free)).toBe(true);
    let played: ("standard" | "premium" | "studio")[] = [];
    for (let i = 0; i < 20; i++) {
      const g = gradeAllowed("premium", played, TIER_BLEND.pro) ? "premium" : "standard";
      played = [...played, g];
    }
    const share = played.filter((g) => g === "premium").length / played.length;
    expect(share).toBeLessThanOrEqual(0.35);
    expect(share).toBeGreaterThanOrEqual(0.25);
  });
});

describe("ledger calls degrade to no credit", () => {
  const failing = { rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "could not find the function" } }) };
  const throwing = { rpc: () => { throw new Error("down"); } };
  it("reads an empty balance and spends nothing when the migration is missing or the call throws", async () => {
    expect(await readGradeBalance(failing, "u")).toEqual(EMPTY_BALANCE);
    expect(await readGradeBalance(throwing, "u")).toEqual(EMPTY_BALANCE);
    expect(await spendGrade(failing, "u", "pro", "premium", "r")).toBeNull();
    expect(await spendGrade(throwing, "u", "pro", "premium", "r")).toBeNull();
    await expect(refundGrade(throwing, "u", "r")).resolves.toBeUndefined();
  });
  it("passes the tier allowance and the month start to the spend function", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db = { rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return Promise.resolve({ data: "allowance", error: null }); } };
    const now = new Date("2026-10-21T10:00:00Z");
    expect(await spendGrade(db, "u", "pro", "studio", "ref1", now)).toBe("allowance");
    expect(calls[0]).toEqual({ fn: "spend_lyric_grade", args: { p_user_id: "u", p_grade: "studio", p_allowance: 2, p_since: "2026-10-01T00:00:00.000Z", p_ref: "ref1" } });
    expect(monthStartUtc(now)).toBe("2026-10-01T00:00:00.000Z");
  });
  it("maps state rows to a balance", async () => {
    const db = { rpc: () => Promise.resolve({ data: [{ grade: "premium", allowance_used: 2, addon_left: 1 }, { grade: "studio", allowance_used: 0, addon_left: 0 }], error: null }) };
    expect(await readGradeBalance(db, "u")).toEqual({ allowanceUsed: { premium: 2, studio: 0 }, addonLeft: { premium: 1, studio: 0 } });
  });
});
