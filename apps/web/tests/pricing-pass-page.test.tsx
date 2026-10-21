import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const world = { user: null as { id: string } | null, pass: false };

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/components/funnel-beacon", () => ({ FunnelBeacon: () => null, sendFunnelEvent: () => undefined }));
vi.mock("@/lib/billing/config", () => ({
  isBillingEnabled: () => true,
  getBillingConfigOrNull: () => ({ stationPassPrice: "price_test" }),
}));
vi.mock("@/lib/billing/pass", () => ({
  passMonthlyTracks: () => 2,
  readOwnStationPass: async () => (world.pass ? { currentPeriodEnd: "2026-12-01", cancelAtPeriodEnd: false } : null),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: world.user } }) } }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { translate } = await import("@/lib/i18n/ui-strings");
  return { serverI18n: async () => ({ lang: "en", t: (k: never, v?: never) => translate("en", k, v) }) };
});

import StationPassPage from "../app/(marketing)/pricing/pass/page";

const render = async () => renderToStaticMarkup(await StationPassPage());

beforeEach(() => {
  world.user = null;
  world.pass = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("/pricing/pass", () => {
  it("is a 404 without STATION_PASS_MIX", async () => {
    await expect(StationPassPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lists the perks, shows the mix picker preview and promises nothing is saved", async () => {
    vi.stubEnv("STATION_PASS_MIX", "1");
    const html = await render();
    expect(html).toContain("Mix up to three languages");
    expect(html).toContain("up to 4 moods");
    expect(html).toContain("No ad breaks.");
    expect(html).toContain("2 personal songs a month");
    expect(html).toContain('data-testid="station-mix"');
    expect(html).toContain("Nothing is saved");
  });

  it("sends a signed-out visitor to sign in, and a signed-in one to the checkout button", async () => {
    vi.stubEnv("STATION_PASS_MIX", "1");
    expect(await render()).toContain("/sign-in?next=");
    world.user = { id: "u1" };
    const html = await render();
    expect(html).toContain("Start the pass");
    expect(html).not.toContain("/sign-in?next=");
  });

  it("shows Manage instead of checkout to a pass holder", async () => {
    vi.stubEnv("STATION_PASS_MIX", "1");
    world.user = { id: "u1" };
    world.pass = true;
    const html = await render();
    expect(html).toContain('data-testid="pass-owned"');
    expect(html).not.toContain("Start the pass");
  });
});
