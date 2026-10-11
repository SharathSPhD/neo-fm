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

import { agentIdFor, requireId } from "../lib/agent/tiers";

describe("agent id handling", () => {
  it("cleans whitespace/quotes and accepts valid ids", () => {
    expect(requireId("X", ' "agent_01AbC"\n', "agent_")).toBe("agent_01AbC");
    expect(agentIdFor("free", { MA_AGENT_ID_FREE: "agent_01Zz" } as unknown as NodeJS.ProcessEnv)).toBe("agent_01Zz");
  });
  it("names the problem without echoing the full value", () => {
    expect(() => requireId("MA_AGENT_ID_FREE", "env_01VeryLongSecretish", "agent_")).toThrow(/malformed.*"env_01\.\.\."/);
    expect(() => requireId("X", undefined, "agent_")).toThrow(/Missing X/);
  });
});

describe("second secret", () => {
  const both = { CRON_SECRET: "aaa", AGENT_TICK_SECRET: "bbb" } as unknown as NodeJS.ProcessEnv;
  it("accepts either secret and rejects others", () => {
    expect(checkBearer("Bearer aaa", both).ok).toBe(true);
    expect(checkBearer("Bearer bbb", both).ok).toBe(true);
    expect(checkBearer("Bearer ccc", both).ok).toBe(false);
  });
});
