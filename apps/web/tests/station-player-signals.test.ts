import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseSignal } from "../lib/station/signals";

const id = "41f1e639-1111-4222-8333-444455556666";
const src = readFileSync("app/(station)/station/station-player.tsx", "utf8");

describe("station listener signals", () => {
  it("the signal API accepts every kind the player can send", () => {
    for (const kind of ["play", "like", "skip", "replay", "share", "finish"]) {
      expect(parseSignal({ trackId: id, kind })).toMatchObject({ kind });
    }
  });

  it("the player posts play, skip, finish, like, replay and share for signed-in listeners", () => {
    // Signed-in listeners use postSignal; only anonymous visitors get the no-op.
    expect(src).toMatch(/const sendSignal = anonymous \? \(\) => \{\} : postSignal/);
    expect(src).toMatch(/sendSignal\(current\.id, "play"/);
    expect(src).toMatch(/sendSignal\(current\.id, kind, audioRef\.current, current\.set\)/); // advance(): skip and finish
    expect(src).toMatch(/onEnded=\{\(\) => advance\("finish"\)\}/);
    expect(src).toMatch(/advance\("skip"\)/);
    for (const k of ["like", "replay", "share"]) expect(src).toContain(`sendSignal(current.id, "${k}"`);
  });
});
