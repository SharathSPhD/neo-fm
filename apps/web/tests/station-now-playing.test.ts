import { describe, expect, it } from "vitest";

import { lockScreenText, nowPlayingEnabled, segmentKind, upNext } from "@/lib/station/now-playing";
import { SLEEP_MINUTES, sleepDue, sleepEndsAt, sleepMinutesLeft } from "@/lib/station/sleep-timer";

const song: { title: string; language: string; type?: "ad" | "voice" } = { title: "Aaj", language: "hi" };
const ad = { title: "x", language: "", type: "ad" as const };
const voice = { title: "y", language: "", type: "voice" as const };
const labels = { ad: "Ad break", host: "Station host", language: "हिन्दी" };

describe("now playing", () => {
  it("is off unless STATION_NOW_PLAYING=1", () => {
    expect(nowPlayingEnabled({})).toBe(false);
    expect(nowPlayingEnabled({ STATION_NOW_PLAYING: "1" })).toBe(true);
  });
  it("tells songs, ad breaks and host links apart", () => {
    expect([song, ad, voice].map(segmentKind)).toEqual(["track", "ad", "voice"]);
    expect(segmentKind(null)).toBe("track");
  });
  it("peeks at the second queue item only", () => {
    expect(upNext([song])).toBeNull();
    expect(upNext([song, ad])?.kind).toBe("ad");
    expect(upNext([song, voice, song])?.kind).toBe("voice");
  });
  it("never shows an internal ad or host title on the lock screen", () => {
    expect(lockScreenText(song, labels)).toEqual({ title: "Aaj", album: "हिन्दी" });
    expect(lockScreenText(ad, labels).title).toBe("Ad break");
    expect(lockScreenText(voice, labels).title).toBe("Station host");
  });
});

describe("sleep timer", () => {
  it("offers 15, 30 and 60 minutes", () => expect(SLEEP_MINUTES).toEqual([15, 30, 60]));
  it("is due only once its end has passed, and never when unset", () => {
    const end = sleepEndsAt(15, 1_000);
    expect(end).toBe(1_000 + 15 * 60_000);
    expect(sleepDue(end, end - 1)).toBe(false);
    expect(sleepDue(end, end)).toBe(true);
    expect(sleepDue(null, end)).toBe(false);
  });
  it("rounds minutes left up and floors at zero", () => {
    const end = sleepEndsAt(30, 0);
    expect(sleepMinutesLeft(end, 0)).toBe(30);
    expect(sleepMinutesLeft(end, 29 * 60_000 + 1)).toBe(1);
    expect(sleepMinutesLeft(end, end + 5)).toBe(0);
    expect(sleepMinutesLeft(null, 0)).toBe(0);
  });
});
