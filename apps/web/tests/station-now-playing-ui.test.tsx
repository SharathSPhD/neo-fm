import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { NowPlayingCover, SegmentMarker, SleepTimer, UpNextPeek } from "@/app/(station)/station/now-playing";

describe("now-playing pieces", () => {
  it("renders a decorative generated cover", () => {
    const html = renderToStaticMarkup(createElement(NowPlayingCover, { id: "t1", style: "calm", paused: false }));
    expect(html).toContain('data-testid="np-cover"');
    expect(html).toContain("aria-hidden");
    expect(html).toContain("linear-gradient");
  });
  it("labels the segment kind", () => {
    expect(renderToStaticMarkup(createElement(SegmentMarker, { kind: "ad" }))).toContain("Ad break");
    expect(renderToStaticMarkup(createElement(SegmentMarker, { kind: "voice" }))).toContain("Station host");
    expect(renderToStaticMarkup(createElement(SegmentMarker, { kind: "track" }))).toContain("Now playing");
  });
  it("shows the next song by title and a break by its kind", () => {
    expect(renderToStaticMarkup(createElement(UpNextPeek, { next: { title: "Raat", language: "hi" } }))).toContain("Raat");
    const ad = renderToStaticMarkup(createElement(UpNextPeek, { next: { type: "ad", title: "secret", language: "" } }));
    expect(ad).toContain("Ad break");
    expect(ad).not.toContain("secret");
    expect(renderToStaticMarkup(createElement(UpNextPeek, { next: null }))).toBe("");
  });
  it("offers the timer options with nothing running by default", () => {
    const html = renderToStaticMarkup(createElement(SleepTimer, { endsAt: null, onSet: () => undefined }));
    expect(html).toContain("15 min");
    expect(html).toContain("60 min");
    expect(html).not.toContain('role="status"');
  });
});
