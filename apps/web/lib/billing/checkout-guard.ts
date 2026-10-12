/**
 * Statuses where Stripe still holds a subscription that can bill the customer (past_due and unpaid recover when the
 * card is fixed). A new Checkout on top of one of these would double-bill. canceled, incomplete and
 * incomplete_expired hold nothing and may start fresh.
 */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

export function isLiveSubscriptionStatus(status: string | null | undefined): boolean {
  return status != null && LIVE_STATUSES.has(status);
}

/** Where a blocked user manages the existing plan (the account page hosts the portal button). */
export const MANAGE_PLAN_URL = "/account";

export interface CheckoutErrorView {
  message: string;
  /** Present when the user should be sent to manage the existing plan instead of retrying. */
  manageUrl?: string;
}

export function checkoutErrorView(status: number, body: { error?: string; details?: string; manage_url?: string }): CheckoutErrorView {
  if (status === 409 && body.error === "already_subscribed") {
    return { message: "You already have a plan. Manage it to change or cancel.", manageUrl: body.manage_url ?? MANAGE_PLAN_URL };
  }
  return { message: body.details ?? body.error ?? "Couldn't start checkout. Try again in a minute." };
}
