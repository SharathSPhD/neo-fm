// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { firstTouchUtm, sendFunnelEvent } from "../components/funnel-beacon";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), clear: () => m.clear() };
};
const visit = (search: string) => vi.stubGlobal("location", { search });
const bodies = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.unstubAllGlobals();
  fetchMock = vi.fn().mockResolvedValue({});
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", store());
  vi.stubGlobal("sessionStorage", store());
  vi.stubGlobal("navigator", { doNotTrack: null });
  visit("");
});

describe("first-touch utm in the browser", () => {
  it("remembers the first campaign and ignores later ones", () => {
    visit("?utm_source=instagram&utm_campaign=diwali");
    expect(firstTouchUtm()).toMatchObject({ source: "instagram", campaign: "diwali" });
    visit("?utm_source=twitter&utm_campaign=other");
    expect(firstTouchUtm()).toMatchObject({ source: "instagram", campaign: "diwali" });
  });

  it("sends the stored campaign with later events from pages without utm", () => {
    visit("?utm_source=instagram&utm_campaign=diwali");
    sendFunnelEvent("landing_view");
    visit("");
    sendFunnelEvent("signup_view");
    expect(bodies(fetchMock)[1]).toEqual({ event: "signup_view", utm: expect.objectContaining({ source: "instagram", campaign: "diwali" }) });
  });

  it("sends no utm when there never was one", () => {
    sendFunnelEvent("landing_view");
    expect(bodies(fetchMock)[0]).toEqual({ event: "landing_view" });
  });

  it("sends nothing under Do Not Track", () => {
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    visit("?utm_source=instagram");
    sendFunnelEvent("pricing_view");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still works with storage blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    visit("?utm_source=instagram");
    sendFunnelEvent("landing_view");
    expect(bodies(fetchMock)[0]).toMatchObject({ utm: { source: "instagram" } });
  });
});
