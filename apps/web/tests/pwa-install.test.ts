import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import manifest from "../app/manifest";
import { SPLASH, startupImages } from "../lib/pwa/splash";

describe("web install", () => {
  it("has a standalone manifest with any and maskable icons", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.display_override).toContain("standalone");
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("has a launch image file for every listed device", () => {
    expect(startupImages).toHaveLength(SPLASH.length);
    for (const img of startupImages) {
      expect(existsSync(join(__dirname, "../public", img.url))).toBe(true);
      expect(img.media).toContain("orientation: portrait");
    }
  });
});
