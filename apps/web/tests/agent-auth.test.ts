import { describe, expect, it } from "vitest";

import { checkBearer, cleanSecret } from "../lib/agent/auth";

const env = (v?: string) => ({ CRON_SECRET: v }) as unknown as NodeJS.ProcessEnv;

describe("checkBearer", () => {
  it("accepts the exact secret", () => expect(checkBearer("Bearer s3cret", env("s3cret")).ok).toBe(true));
  it("tolerates trailing newline/space and wrapping quotes in the env value", () => {
    expect(checkBearer("Bearer s3cret", env("s3cret\n")).ok).toBe(true);
    expect(checkBearer("Bearer s3cret", env('"s3cret"')).ok).toBe(true);
  });
  it("rejects wrong, missing and unconfigured", () => {
    expect(checkBearer("Bearer nope", env("s3cret")).ok).toBe(false);
    expect(checkBearer(null, env("s3cret"))).toMatchObject({ ok: false, diag: { bearer_present: false } });
    expect(checkBearer("Bearer s3cret", env(undefined))).toMatchObject({ ok: false, diag: { secret_configured: false } });
  });
  it("never accepts an empty secret", () => expect(checkBearer("Bearer ", env("")).ok).toBe(false));
  it("cleanSecret leaves inner quotes alone", () => expect(cleanSecret("a'b")).toBe("a'b"));
});
