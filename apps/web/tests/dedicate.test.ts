import { describe, expect, it } from "vitest";

import { cleanDedicatee, dedicateEnabled, dedicateHourUrl } from "../lib/station/dedicate";

describe("cleanDedicatee", () => {
  it("keeps names in any script and tidies spacing", () => {
    expect(cleanDedicatee("  Asha ")).toBe("Asha");
    expect(cleanDedicatee("आशा   जी")).toBe("आशा जी");
    expect(cleanDedicatee("அம்மா")).toBe("அம்மா");
    expect(cleanDedicatee("Mary-Ann O'Neil")).toBe("Mary-Ann O'Neil");
  });
  it("drops links, markup and digits", () => {
    expect(cleanDedicatee("<b>Ravi</b>")).toBe("bRavib");
    expect(cleanDedicatee("http://evil.example/pay")).toBe("httpevilexamplepay");
    expect(cleanDedicatee("12345")).toBeNull();
    expect(cleanDedicatee("   ")).toBeNull();
    expect(cleanDedicatee(undefined)).toBeNull();
  });
  it("caps the length", () => {
    expect(cleanDedicatee("a".repeat(80))?.length).toBe(24);
  });
});

describe("dedicateHourUrl", () => {
  it("links a named station and the name", () => {
    expect(dedicateHourUrl("raat", "Meera", "https://neo-fm.com")).toBe("https://neo-fm.com/station?s=raat&for=Meera");
  });
  it("ignores an unknown station and rejects an unusable name", () => {
    expect(dedicateHourUrl("nope", "Meera", "https://neo-fm.com")).toBe("https://neo-fm.com/station?for=Meera");
    expect(dedicateHourUrl("raat", "123", "https://neo-fm.com")).toBeNull();
  });
});

describe("dedicateEnabled", () => {
  it("is on only for STATION_DEDICATE=1", () => {
    expect(dedicateEnabled({ STATION_DEDICATE: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(dedicateEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
