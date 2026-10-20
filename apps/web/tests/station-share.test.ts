import { describe, expect, it } from "vitest";

import { isTrackId, trackShareUrl, whatsappShareUrl } from "@/lib/station/share";

describe("station share links", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";

  it("builds a per-track url without double slashes", () => {
    expect(trackShareUrl(id, "https://www.neo-fm.com/")).toBe(`https://www.neo-fm.com/t/${id}`);
  });

  it("accepts uuids only", () => {
    expect(isTrackId(id)).toBe(true);
    expect(isTrackId("../etc/passwd")).toBe(false);
    expect(isTrackId("")).toBe(false);
  });

  it("encodes the whatsapp text", () => {
    const u = whatsappShareUrl("Hindi folk & more", trackShareUrl(id, "https://x.test"));
    expect(u.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(u.split("text=")[1] ?? "")).toBe(`Hindi folk & more on neo-fm. Listen: https://x.test/t/${id}`);
  });
});
