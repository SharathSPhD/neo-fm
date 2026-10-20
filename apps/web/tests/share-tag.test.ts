import { describe, expect, it } from "vitest";

import { utmFromSearch } from "../lib/ops/utm";
import { tagShareUrl } from "../lib/share/tag";

describe("tagShareUrl", () => {
  it("adds source, medium and campaign that the funnel reads back", () => {
    const url = tagShareUrl("https://www.neo-fm.com/s/abc123", { source: "whatsapp", campaign: "clip" });
    expect(url).toBe("https://www.neo-fm.com/s/abc123?utm_source=whatsapp&utm_medium=share&utm_campaign=clip");
    expect(utmFromSearch(new URL(url).search)).toMatchObject({ source: "whatsapp", medium: "share", campaign: "clip" });
  });

  it("keeps existing params and only sends a well-formed ref", () => {
    const ok = tagShareUrl("https://x.test/t/1?a=1", { source: "copy", campaign: "station", ref: "k3j9z2ab".replace("9", "5") });
    expect(new URL(ok).searchParams.get("a")).toBe("1");
    expect(new URL(ok).searchParams.get("ref")).toBe("k3j5z2ab");
    expect(new URL(tagShareUrl("https://x.test/t/1", { source: "copy", campaign: "station", ref: "BAD!" })).searchParams.has("ref")).toBe(false);
  });

  it("leaves an unparseable url alone", () => {
    expect(tagShareUrl("/s/abc", { source: "copy", campaign: "clip" })).toBe("/s/abc");
  });
});
