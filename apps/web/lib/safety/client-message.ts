import type { UiKey } from "../i18n/ui-strings";

/**
 * Turns a 422/503 content_policy response from POST /api/songs into the message shown under the prompt box.
 * Returns null for anything else so callers fall through to their generic error. The server reason is already
 * written for the user; the localized frame tells them nothing was spent and that they can edit and retry.
 */
export async function policyErrorMessage(
  res: Response,
  t: (key: UiKey, vars?: Record<string, string | number>) => string,
): Promise<string | null> {
  if (res.status !== 422 && res.status !== 503) return null;
  const body = (await res.clone().json().catch(() => null)) as { error?: string; category?: string; message?: string } | null;
  if (body?.error !== "content_policy") return null;
  if (body.category === "moderation_unavailable") return t("prompt.errPolicyBusy");
  return t("prompt.errPolicy", { reason: (body.message ?? "").trim() });
}
