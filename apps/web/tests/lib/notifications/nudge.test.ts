import { describe, expect, it, vi } from "vitest";

import { NUDGE_COPY, NUDGE_LANGS, nudgeLang } from "@/lib/notifications/nudge-copy";
import { runStationNudge, stationNudgeEnabled } from "@/lib/notifications/nudge";
import { sendPush, type PushConfig } from "@/lib/notifications/push";
import { sendNative, type FcmConfig } from "@/lib/notifications/fcm";
import { applyPrefsPatch, NUDGE_LAST_KEY, resolvePrefs } from "@/lib/notifications/types";

const cfg: PushConfig = { publicKey: "k", privateKey: "p", subject: "mailto:a@b.c" };
const NOW = Date.parse("2026-10-19T13:30:00Z");

/** Minimal chainable stand-in for the three queries the job makes. */
function fakeDb(
  prefs: { user_id: string; prefs: Record<string, unknown> }[],
  subs: Record<string, unknown>[],
  jobs: { user_id: string; song_documents: { language: string } }[] = [],
  tokens: { id: string; user_id: string; token: string }[] = [],
) {
  const updates: { user_id: string; prefs: Record<string, unknown> }[] = [];
  const deleted: string[][] = [];
  const db = {
    from(table: string) {
      if (table === "notification_prefs") {
        return {
          select: () => ({ eq: () => ({ limit: () => ({ returns: async () => ({ data: prefs, error: null }) }) }) }),
          update: (row: { prefs: Record<string, unknown> }) => ({
            eq: async (_c: string, id: string) => void updates.push({ user_id: id, prefs: row.prefs }),
          }),
        };
      }
      if (table === "jobs") {
        return { select: () => ({ in: () => ({ order: () => ({ limit: () => ({ returns: async () => ({ data: jobs, error: null }) }) }) }) }) };
      }
      const rows = table === "native_push_tokens" ? tokens : subs;
      return {
        select: () => ({ in: () => ({ returns: async () => ({ data: rows, error: null }) }) }),
        delete: () => ({ in: async (_c: string, ids: string[]) => void deleted.push(ids) }),
      };
    },
  };
  return { db: db as never, updates, deleted };
}

const sub = (id: string, user: string) => ({ id, user_id: user, endpoint: `https://fcm.googleapis.com/${id}`, p256dh: "x", auth: "y" });

describe("station nudge", () => {
  it("is off unless STATION_NUDGE_ENABLED=1", () => {
    expect(stationNudgeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(stationNudgeEnabled({ STATION_NUDGE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(stationNudgeEnabled({ STATION_NUDGE_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("is opt-in by default", () => {
    expect(resolvePrefs(null).station_nudge.push).toBe(false);
  });

  it("sends once per day to opted-in users and records the date", async () => {
    const { db, updates } = fakeDb(
      [
        { user_id: "u1", prefs: { station_nudge: { push: true } } },
        { user_id: "u2", prefs: { station_nudge: { push: true }, [NUDGE_LAST_KEY]: "2026-10-19" } },
      ],
      [sub("s1", "u1"), sub("s2", "u2")],
    );
    const send = vi.fn<typeof sendPush>(async () => "sent");
    const r = await runStationNudge(db, cfg, send, NOW);
    expect(r).toMatchObject({ optedIn: 2, skippedToday: 1, sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![2]).toMatchObject({ title: "Your station is ready", url: "/station" });
    expect(updates).toEqual([{ user_id: "u1", prefs: { station_nudge: { push: true }, [NUDGE_LAST_KEY]: "2026-10-19" } }]);
  });

  it("sends the copy in the language of the user's latest song, English otherwise", async () => {
    const { db } = fakeDb(
      [
        { user_id: "u1", prefs: { station_nudge: { push: true } } },
        { user_id: "u2", prefs: { station_nudge: { push: true } } },
        { user_id: "u3", prefs: { station_nudge: { push: true } } },
      ],
      [sub("s1", "u1"), sub("s2", "u2"), sub("s3", "u3")],
      [
        { user_id: "u1", song_documents: { language: "kn" } },
        { user_id: "u2", song_documents: { language: "bn" } },
      ],
    );
    const send = vi.fn<typeof sendPush>(async () => "sent");
    await runStationNudge(db, cfg, send, NOW);
    const titles = send.mock.calls.map((c) => c[2].title);
    expect(titles).toEqual([NUDGE_COPY.kn.title, NUDGE_COPY.en.title, NUDGE_COPY.en.title]);
  });

  it("has non-empty, distinct copy for every nudge language", () => {
    for (const l of NUDGE_LANGS) expect(NUDGE_COPY[l].title && NUDGE_COPY[l].body).toBeTruthy();
    expect(new Set(NUDGE_LANGS.map((l) => NUDGE_COPY[l].title)).size).toBe(NUDGE_LANGS.length);
    expect(nudgeLang("fr")).toBe("en");
    expect(nudgeLang("mr")).toBe("mr");
  });

  it("removes dead subscriptions and does not mark a failed send as sent", async () => {
    const { db, updates, deleted } = fakeDb([{ user_id: "u1", prefs: { station_nudge: { push: true } } }], [sub("s1", "u1")]);
    const r = await runStationNudge(db, cfg, async () => "gone", NOW);
    expect(r).toMatchObject({ sent: 0, failed: 1, removedSubscriptions: 1 });
    expect(updates).toEqual([]);
    expect(deleted).toEqual([["s1"]]);
  });

  it("nudges an opted-in user who only has the app (FCM token), once a day, and drops dead tokens", async () => {
    const fcm = { projectId: "p", clientEmail: "e", privateKey: "k" } as unknown as FcmConfig;
    const tok = (id: string, user: string) => ({ id, user_id: user, token: `${id}-`.padEnd(30, "x") });
    const { db, updates, deleted } = fakeDb(
      [
        { user_id: "u1", prefs: { station_nudge: { push: true } } },
        { user_id: "u2", prefs: { station_nudge: { push: true } } },
      ],
      [],
      [],
      [tok("t1", "u1"), tok("t2", "u2")],
    );
    const web = vi.fn<typeof sendPush>(async () => "sent");
    const app = vi.fn<typeof sendNative>(async (_c, token) => (token.startsWith("t2") ? "gone" : "sent"));
    const r = await runStationNudge(db, cfg, web, NOW, { cfg: fcm, send: app });
    expect(web).not.toHaveBeenCalled();
    expect(app).toHaveBeenCalledTimes(2);
    expect(app.mock.calls[0]![2]).toMatchObject({ title: "Your station is ready", url: "/station" });
    expect(r).toMatchObject({ optedIn: 2, sent: 1, failed: 1, removedSubscriptions: 1 });
    expect(updates.map((u) => u.user_id)).toEqual(["u1"]);
    expect(deleted).toEqual([["t2"]]);
  });

  it("a user toggling a switch keeps the last-sent date", () => {
    const next = applyPrefsPatch({ [NUDGE_LAST_KEY]: "2026-10-19" }, { like: { push: true } });
    expect(next[NUDGE_LAST_KEY]).toBe("2026-10-19");
  });
});
