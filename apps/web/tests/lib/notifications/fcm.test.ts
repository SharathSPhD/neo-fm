import { generateKeyPairSync } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { drainPush } from "@/lib/notifications/drain";
import { fcmConfig, sendNative, type FcmConfig } from "@/lib/notifications/fcm";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const account = { project_id: "neo-fm-app", client_email: "fcm@neo-fm-app.iam.gserviceaccount.com", private_key: pem };
const cfg: FcmConfig = { projectId: account.project_id, clientEmail: account.client_email, privateKey: pem };

describe("fcmConfig", () => {
  it("is off without the flag or without the key", () => {
    expect(fcmConfig({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(account) } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(fcmConfig({ NEO_FM_NATIVE_PUSH_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(fcmConfig({ NEO_FM_NATIVE_PUSH_ENABLED: "true", FCM_SERVICE_ACCOUNT_JSON: "not json" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("reads raw or base64 service account JSON", () => {
    const json = JSON.stringify(account);
    for (const v of [json, Buffer.from(json).toString("base64")]) {
      expect(fcmConfig({ NEO_FM_NATIVE_PUSH_ENABLED: "true", FCM_SERVICE_ACCOUNT_JSON: v } as unknown as NodeJS.ProcessEnv)).toMatchObject({ projectId: "neo-fm-app" });
    }
  });
});

function fakeFetch(fcm: { status: number }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    return new Response("{}", { status: fcm.status });
  }) as unknown as typeof fetch;
}

describe("sendNative", () => {
  const msg = { title: "Your song is ready", body: "Open it", url: "/s/abc", tag: "n1" };
  it("maps FCM answers: 200 sent, 404 gone, others failed", async () => {
    expect(await sendNative(cfg, "t".repeat(30), msg, fakeFetch({ status: 200 }))).toBe("sent");
    expect(await sendNative(cfg, "t".repeat(30), msg, fakeFetch({ status: 404 }))).toBe("gone");
    expect(await sendNative(cfg, "t".repeat(30), msg, fakeFetch({ status: 500 }))).toBe("failed");
    expect(await sendNative(cfg, "t".repeat(30), msg, fakeFetch({ status: 400 }))).toBe("failed");
  });
  it("posts to the project's v1 endpoint with a bearer token and the click url", async () => {
    const f = fakeFetch({ status: 200 });
    await sendNative(cfg, "t".repeat(30), msg, f);
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("fcm.googleapis.com"))!;
    expect(String(call[0])).toBe("https://fcm.googleapis.com/v1/projects/neo-fm-app/messages:send");
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(String(init.body)).message.data.url).toBe("/s/abc");
  });
});

/** Minimal chainable stand-in for the supabase calls drainPush makes. */
function fakeDb(tables: Record<string, unknown[] | { error: unknown }>) {
  const updates: { table: string; patch: unknown }[] = [];
  const deletes: { table: string; ids: unknown }[] = [];
  const db = {
    from(table: string) {
      const rows = tables[table];
      const result = Array.isArray(rows) ? { data: rows, error: null } : { data: null, error: (rows as { error: unknown } | undefined)?.error ?? null };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        in: (_c: string, ids: unknown) => {
          if ((q as { _del?: boolean })._del) deletes.push({ table, ids });
          return q;
        },
        returns: () => Promise.resolve(result),
        update: (patch: unknown) => {
          updates.push({ table, patch });
          return q;
        },
        delete: () => {
          (q as { _del?: boolean })._del = true;
          return q;
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, updates, deletes };
}

describe("drainPush with app tokens", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const note = { id: "n1", user_id: "u1", type: "song_ready", data: { title: "Raat" }, count: 1, created_at: new Date(now - 60_000).toISOString(), read_at: null };

  it("sends to an app token when there is no browser config and removes a dead token", async () => {
    const { db, updates, deletes } = fakeDb({ notifications: [note], native_push_tokens: [{ id: "k1", user_id: "u1", token: "a".repeat(30) }] });
    const send = vi.fn(async () => "gone" as const);
    const out = await drainPush(db, null, undefined, now, { cfg, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(out.failed).toBe(1);
    expect(out.removedSubscriptions).toBe(1);
    expect(deletes).toEqual([{ table: "native_push_tokens", ids: ["k1"] }]);
    expect(updates.some((u) => u.table === "notifications")).toBe(true);
  });
  it("counts a sent app push", async () => {
    const { db } = fakeDb({ notifications: [note], native_push_tokens: [{ id: "k1", user_id: "u1", token: "a".repeat(30) }] });
    const out = await drainPush(db, null, undefined, now, { cfg, send: async () => "sent" });
    expect(out.sent).toBe(1);
  });
  it("a missing tokens table changes nothing for web push", async () => {
    const { db } = fakeDb({
      notifications: [note],
      push_subscriptions: [{ id: "s1", user_id: "u1", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" }],
      native_push_tokens: { error: { code: "42P01" } },
    });
    const web = vi.fn(async () => "sent" as const);
    const app = vi.fn(async () => "sent" as const);
    const out = await drainPush(db, { publicKey: "k", privateKey: "p", subject: "mailto:a@b.c" }, web, now, { cfg, send: app });
    expect(web).toHaveBeenCalledTimes(1);
    expect(app).not.toHaveBeenCalled();
    expect(out.sent).toBe(1);
  });
});
