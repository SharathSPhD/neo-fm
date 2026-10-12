"use client";

/**
 * Browser side of error reporting. Best effort and bounded: a crash loop must
 * not turn into a request storm, so we cap reports per page load and skip
 * exact repeats. Never throws.
 */
import type { UiLang } from "../i18n/ui-strings";

type Boundary = "app" | "marketing" | "root" | "global" | "window" | "promise";

const MAX_PER_PAGE = 5;
const seen = new Set<string>();

export function reportClientError(
  error: unknown,
  opts: { boundary: Boundary; digest?: string; lang?: UiLang },
): void {
  try {
    if (seen.size >= MAX_PER_PAGE) return;
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error thrown");
    const key = `${e.name}|${e.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    const body = JSON.stringify({
      name: e.name,
      message: e.message || "(no message)",
      stack: e.stack,
      url: window.location.pathname,
      boundary: opts.boundary,
      lang: opts.lang,
      digest: opts.digest,
      release: process.env.NEXT_PUBLIC_APP_VERSION,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/client-errors", blob)) return;
    void fetch("/api/client-errors", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Reporting must never be the thing that throws.
  }
}
