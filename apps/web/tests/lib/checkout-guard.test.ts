import { describe, expect, it } from "vitest";

import { checkoutErrorView, isLiveSubscriptionStatus } from "../../lib/billing/checkout-guard";

describe("checkout guard", () => {
  it.each([["active", true], ["trialing", true], ["past_due", true], ["unpaid", true], ["canceled", false], ["incomplete", false], ["incomplete_expired", false], ["inactive", false], [null, false]] as const)(
    "status %s live=%s",
    (status, live) => expect(isLiveSubscriptionStatus(status)).toBe(live),
  );
  it("maps already_subscribed to a manage-plan link", () => {
    expect(checkoutErrorView(409, { error: "already_subscribed", manage_url: "/account" })).toMatchObject({ manageUrl: "/account" });
    expect(checkoutErrorView(409, { error: "already_subscribed" }).manageUrl).toBe("/account");
  });
  it("keeps other errors as plain messages without a link", () => {
    expect(checkoutErrorView(502, { details: "boom" })).toEqual({ message: "boom" });
    expect(checkoutErrorView(500, {}).manageUrl).toBeUndefined();
  });
});
