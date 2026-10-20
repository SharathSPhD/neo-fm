import { describe, expect, it, vi } from "vitest";

import { claimReferral, ensureRefCode } from "../lib/referral/claim";
import { cleanRef, newRefCode, referralEnabled, refFromCookieHeader } from "../lib/referral/code";

const ON = { REFERRAL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

describe("refFromCookieHeader", () => {
  it("finds a valid code among other cookies and rejects malformed ones", () => {
    expect(refFromCookieHeader("a=1; nfm_ref=abcdefgh; b=2")).toBe("abcdefgh");
    expect(refFromCookieHeader("nfm_ref=BAD")).toBeNull();
    expect(refFromCookieHeader(null)).toBeNull();
  });
});

describe("referral codes", () => {
  it("accepts only 8 lowercase base32 characters", () => {
    expect(cleanRef("abcdefgh")).toBe("abcdefgh");
    expect(cleanRef("abc23567")).toBe("abc23567");
    for (const bad of ["ABCDEFGH", "abcdefg", "abcdefghi", "abcd1fgh", "abc-efgh", "", null, 7]) expect(cleanRef(bad)).toBeNull();
  });
  it("generates codes that pass validation", () => {
    for (let i = 0; i < 50; i++) expect(cleanRef(newRefCode())).not.toBeNull();
  });
  it("is off unless REFERRAL_ENABLED=1", () => {
    expect(referralEnabled(OFF)).toBe(false);
    expect(referralEnabled({ REFERRAL_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(referralEnabled(ON)).toBe(true);
  });
});

const rpcDb = (data: unknown, error: unknown = null) => {
  const rpc = vi.fn(async () => ({ data, error }));
  return { db: { rpc } as never, rpc };
};

describe("claimReferral", () => {
  it("does nothing while the flag is off or the code is malformed", async () => {
    const { db, rpc } = rpcDb("ok");
    expect(await claimReferral(db, "u", "abcdefgh", OFF)).toBeNull();
    expect(await claimReferral(db, "u", "NOPE", ON)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes a valid claim to the database and returns its verdict", async () => {
    const { db, rpc } = rpcDb("ok");
    expect(await claimReferral(db, "u1", "abcdefgh", ON)).toBe("ok");
    expect(rpc).toHaveBeenCalledWith("claim_referral", { p_receiver: "u1", p_code: "abcdefgh" });
  });
  it("swallows database errors and thrown failures", async () => {
    expect(await claimReferral(rpcDb(null, { message: "no function" }).db, "u", "abcdefgh", ON)).toBeNull();
    const boom = { rpc: async () => { throw new Error("down"); } } as never;
    expect(await claimReferral(boom, "u", "abcdefgh", ON)).toBeNull();
  });
});

function codesDb(opts: { existing?: string; insertErrors?: ({ code?: string } | null)[] }) {
  const errors = [...(opts.insertErrors ?? [null])];
  const inserted: object[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ? { code: opts.existing } : null, error: null }) }) }),
      insert: async (row: object) => { inserted.push(row); return { error: errors.shift() ?? null }; },
    }),
  };
  return { db: db as never, inserted };
}

describe("ensureRefCode", () => {
  it("returns null while the flag is off", async () => {
    expect(await ensureRefCode(codesDb({}).db, "u", OFF)).toBeNull();
  });
  it("reuses an existing code and creates a valid one otherwise", async () => {
    expect(await ensureRefCode(codesDb({ existing: "abcdefgh" }).db, "u", ON)).toBe("abcdefgh");
    const c = codesDb({});
    const code = await ensureRefCode(c.db, "u", ON);
    expect(cleanRef(code)).not.toBeNull();
    expect(c.inserted).toEqual([{ user_id: "u", code }]);
  });
  it("retries a code collision and gives up on other errors", async () => {
    const c = codesDb({ insertErrors: [{ code: "23505" }, null] });
    expect(cleanRef(await ensureRefCode(c.db, "u", ON))).not.toBeNull();
    expect(c.inserted).toHaveLength(2);
    expect(await ensureRefCode(codesDb({ insertErrors: [{ code: "42P01" }] }).db, "u", ON)).toBeNull();
  });
});
