import { describe, expect, it, vi } from "vitest";

import { runStationNudge } from "@/lib/notifications/nudge";
import { nudgeHour, nudgeMoods, nudgeTasteEnabled, tasteNudge } from "@/lib/notifications/nudge-taste";
import type { PushConfig } from "@/lib/notifications/push";
import { sendPush } from "@/lib/notifications/push";
import { NUDGE_LAST_KEY } from "@/lib/notifications/types";
import type { TasteBrief } from "@/lib/taste/brief";

const cfg: PushConfig = { publicKey: "k", privateKey: "p", subject: "mailto:a@b.c" };
// 04:30 UTC is 10:00 in India: a morning nudge.
const MORNING = Date.parse("2026-10-21T04:30:00Z");
const NIGHT = Date.parse("2026-10-21T17:00:00Z");

const t = (x: Partial<TasteBrief>): TasteBrief => ({ v: 1, ...x }) as TasteBrief;

describe("taste-aware nudge", () => {
  it("is off unless NUDGE_TASTE=1", () => {
    expect(nudgeTasteEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(nudgeTasteEnabled({ NUDGE_TASTE: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("reads the hour in India time", () => {
    expect(nudgeHour(MORNING)).toBe(10);
    expect(nudgeHour(NIGHT)).toBe(22);
  });

  it("prefers the mood asked for at this time of day, then general picks, station moods only, at most two", () => {
    expect(nudgeMoods(t({ moods: ["calm", "romantic"], daypart_moods: { morning: "joyful" } }), "morning")).toEqual(["joyful", "calm"]);
    expect(nudgeMoods(t({ moods: ["calm", "romantic"], daypart_moods: { morning: "joyful" } }), "night")).toEqual(["calm", "romantic"]);
    expect(nudgeMoods(t({ moods: ["wistful", "calm"] }), "morning")).toEqual(["calm"]);
    expect(nudgeMoods(t({ moods: ["calm", "calm"] }), "morning")).toEqual(["calm"]);
  });

  it("writes copy and a deep link from the saved moods, languages and daypart", () => {
    const n = tasteNudge(t({ moods: ["calm", "romantic"], languages: ["kn"] }), undefined, MORNING)!;
    expect(n.href).toBe("/station?lang=kn&moods=calm%2Cromantic");
    expect(n.body).toContain("ಬೆಳಿಗ್ಗೆ");
    expect(n.body).toContain("ಶಾಂತ");
    const en = tasteNudge(t({ moods: ["calm"] }), "en", NIGHT)!;
    expect(en.body).toBe("Night: calm");
    expect(en.href).toBe("/station?moods=calm");
  });

  it("returns nothing without a usable mood or station language, so the plain nudge goes out", () => {
    expect(tasteNudge(null, "en", MORNING)).toBeNull();
    expect(tasteNudge(t({ genres: ["carnatic"] }), "en", MORNING)).toBeNull();
    expect(tasteNudge(t({ moods: ["wistful"], languages: ["mr"] }), "en", MORNING)).toBeNull();
  });
});

function fakeDb(taste: { user_id: string; stated: unknown }[] | "error") {
  const db = {
    from(table: string) {
      if (table === "notification_prefs") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                returns: async () => ({
                  data: ["u1", "u2"].map((id) => ({ user_id: id, prefs: { station_nudge: { push: true } } })),
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({ eq: async () => undefined }),
        };
      }
      if (table === "taste_profiles") {
        return { select: () => ({ in: async () => (taste === "error" ? { data: null, error: { message: "no column" } } : { data: taste, error: null }) }) };
      }
      if (table === "jobs") return { select: () => ({ in: () => ({ order: () => ({ limit: () => ({ returns: async () => ({ data: [], error: null }) }) }) }) }) };
      return {
        select: () => ({
          in: () => ({
            returns: async () => ({
              data: ["u1", "u2"].map((u) => ({ id: `s-${u}`, user_id: u, endpoint: `https://x/${u}`, p256dh: "x", auth: "y" })),
              error: null,
            }),
          }),
        }),
        delete: () => ({ in: async () => undefined }),
      };
    },
  };
  return db as never;
}

describe("runStationNudge with NUDGE_TASTE", () => {
  it("personalises users with a saved profile and keeps the plain nudge for the rest", async () => {
    const send = vi.fn<typeof sendPush>(async () => "sent");
    const db = fakeDb([{ user_id: "u1", stated: { v: 1, moods: ["calm"], languages: ["hi"] } }]);
    const r = await runStationNudge(db, cfg, send, MORNING, undefined, true);
    expect(r).toMatchObject({ sent: 2, personalised: 1 });
    const payloads = send.mock.calls.map((c) => c[2]);
    expect(payloads[0]).toMatchObject({ url: "/station?lang=hi&moods=calm" });
    expect(payloads[0]!.body).toContain("सुबह");
    expect(payloads[1]).toMatchObject({ title: "Your station is ready", url: "/station" });
  });

  it("falls back to the plain nudge when the taste table is unavailable", async () => {
    const send = vi.fn<typeof sendPush>(async () => "sent");
    const r = await runStationNudge(fakeDb("error"), cfg, send, MORNING, undefined, true);
    expect(r).toMatchObject({ sent: 2, personalised: 0 });
    expect(send.mock.calls.every((c) => c[2].url === "/station")).toBe(true);
  });

  it("does nothing different with the flag off", async () => {
    const send = vi.fn<typeof sendPush>(async () => "sent");
    const db = fakeDb([{ user_id: "u1", stated: { v: 1, moods: ["calm"] } }]);
    const r = await runStationNudge(db, cfg, send, MORNING, undefined, false);
    expect(r.personalised).toBe(0);
    expect(send.mock.calls.every((c) => c[2].url === "/station")).toBe(true);
    expect(NUDGE_LAST_KEY).toBeTruthy();
  });
});
