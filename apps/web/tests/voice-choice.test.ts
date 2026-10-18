import { describe, expect, it } from "vitest";

import { clampVoicePref, parseVoicePref, voiceEntitlement, voiceHint, voiceHintFor } from "../lib/voice";

const ON = { VOICE_CHOICE: "1" } as unknown as NodeJS.ProcessEnv;

describe("voice entitlement by tier", () => {
  it("gives free the station mix only", () => {
    expect(voiceEntitlement("free").choices).toEqual(["station"]);
    expect(voiceEntitlement(null).styles).toEqual([]);
  });
  it("gives creator and Station pass male/female, pro everything", () => {
    expect(voiceEntitlement("creator").choices).toEqual(["station", "female", "male"]);
    expect(voiceEntitlement("free", true).choices).toContain("male");
    expect(voiceEntitlement("pro").choices).toContain("duet");
    expect(voiceEntitlement("pro").styles.length).toBeGreaterThan(0);
  });
});

describe("parseVoicePref and clampVoicePref", () => {
  it("drops junk", () => {
    expect(parseVoicePref(null)).toBeNull();
    expect(parseVoicePref({ choice: "robot" })).toBeNull();
    expect(parseVoicePref({ choice: "male", style: "evil" })).toEqual({ choice: "male" });
  });
  it("falls back to station above the tier", () => {
    expect(clampVoicePref({ choice: "duet" }, voiceEntitlement("creator"))).toEqual({ choice: "station" });
    expect(clampVoicePref({ choice: "male", style: "soft" }, voiceEntitlement("creator"))).toEqual({ choice: "male" });
    expect(clampVoicePref({ choice: "duet", style: "soft" }, voiceEntitlement("pro"))).toEqual({ choice: "duet", style: "soft" });
  });
});

describe("voiceHintFor", () => {
  it("is empty when the flag is off", () => {
    expect(voiceHintFor({ choice: "male" }, "pro", false, {} as unknown as NodeJS.ProcessEnv)).toBe("");
  });
  it("is empty for the station mix and for an unentitled request", () => {
    expect(voiceHint({ choice: "station" })).toBe("");
    expect(voiceHintFor({ choice: "duet" }, "free", false, ON)).toBe("");
  });
  it("adds the gender cue when entitled", () => {
    expect(voiceHintFor({ choice: "female" }, "creator", false, ON)).toBe("Female lead vocal.");
    expect(voiceHintFor({ choice: "duet", style: "folk" }, "pro", false, ON)).toMatch(/duet.*Earthy folk/);
  });
});
