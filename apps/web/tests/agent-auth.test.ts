import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkAdminBearer, checkBearer, checkCronOrAdminBearer, cleanSecret } from "../lib/agent/auth";

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

import { planForTier } from "../lib/agent/tiers";

describe("plan override", () => {
  it("uses the override when valid, ignores junk, otherwise follows the tier", () => {
    expect(planForTier("pro", "free").agent).toBe("free");
    expect(planForTier("free", "pro").agent).toBe("pro");
    expect(planForTier("pro", "weird").agent).toBe("pro");
    expect(planForTier("free", null).agent).toBe("free");
  });
});

describe("admin secret", () => {
  const e = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  it("falls back to the cron/tick secrets while ADMIN_SECRET is unset", () => {
    expect(checkAdminBearer("Bearer aaa", e({ CRON_SECRET: "aaa" })).ok).toBe(true);
  });
  it("accepts only ADMIN_SECRET once it is set", () => {
    const env = e({ CRON_SECRET: "aaa", AGENT_TICK_SECRET: "bbb", ADMIN_SECRET: "adm" });
    expect(checkAdminBearer("Bearer adm", env).ok).toBe(true);
    expect(checkAdminBearer("Bearer aaa", env).ok).toBe(false);
    expect(checkAdminBearer("Bearer bbb", env).ok).toBe(false);
  });
});

describe("cron-invoked admin routes", () => {
  const e = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  const env = e({ CRON_SECRET: "aaa", AGENT_TICK_SECRET: "bbb", ADMIN_SECRET: "adm" });
  it("with ADMIN_SECRET set, CRON_SECRET still passes the cron routes but fails operator routes", () => {
    expect(checkCronOrAdminBearer("Bearer aaa", env).ok).toBe(true);
    expect(checkCronOrAdminBearer("Bearer adm", env).ok).toBe(true);
    expect(checkCronOrAdminBearer("Bearer nope", env).ok).toBe(false);
    expect(checkAdminBearer("Bearer aaa", env).ok).toBe(false);
  });
  it("works unchanged when ADMIN_SECRET is unset", () => {
    expect(checkCronOrAdminBearer("Bearer aaa", e({ CRON_SECRET: "aaa" })).ok).toBe(true);
    expect(checkCronOrAdminBearer(null, e({ CRON_SECRET: "aaa" })).ok).toBe(false);
  });
  it("the routes Vercel Cron calls use the cron-or-admin check, the rest are ADMIN_SECRET-only", () => {
    const dir = join(__dirname, "../app/api/admin");
    const cron = new Set(["health-snapshot", "self-improve", "spend-monitor", "purge-listens"]);
    const crons = (JSON.parse(readFileSync(join(__dirname, "../vercel.json"), "utf8")).crons as { path: string }[])
      .map((c) => c.path).filter((p) => p.startsWith("/api/admin/")).map((p) => p.slice("/api/admin/".length));
    expect(new Set(crons)).toEqual(cron);
    for (const f of readdirSync(dir, { recursive: true }) as string[]) {
      if (!f.endsWith("route.ts")) continue;
      const src = readFileSync(join(dir, f), "utf8");
      const name = f.replace(/\/?route\.ts$/, "");
      if (cron.has(name)) expect(src, f).toContain("checkCronOrAdminBearer(");
      else { expect(src, f).toContain("checkAdminBearer("); expect(src, f).not.toContain("checkCronOrAdminBearer("); }
    }
  });
});
