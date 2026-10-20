import { describe, expect, it } from "vitest";

import { poolCdnUrl } from "../lib/station/cdn";

describe("poolCdnUrl", () => {
  it("is off without a base", () => {
    expect(poolCdnUrl("tracks/pool/a.mp3", undefined)).toBeNull();
    expect(poolCdnUrl("tracks/pool/a.mp3", "")).toBeNull();
  });
  it("builds a url, dropping the bucket prefix and trailing slash", () => {
    expect(poolCdnUrl("tracks/pool/a b.mp3", "https://audio.neo-fm.com/")).toBe("https://audio.neo-fm.com/pool/a%20b.mp3");
  });
  it("refuses non-https bases and path traversal", () => {
    expect(poolCdnUrl("pool/a.mp3", "http://x.test")).toBeNull();
    expect(poolCdnUrl("../a.mp3", "https://x.test")).toBeNull();
  });
});
