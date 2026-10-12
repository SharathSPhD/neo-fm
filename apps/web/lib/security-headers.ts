/**
 * Per-request security header policy for the neo-fm web app.
 *
 * We can't use a static next.config.js `headers()` block because:
 *   - The embed surface (`/embed/<publicId>`) intentionally allows
 *     framing by any third-party site so creators can drop a player
 *     into their own pages. The rest of the app must not be
 *     framable.
 *   - The Supabase project URL is read from env (`NEXT_PUBLIC_*`)
 *     so the connect-src allowlist has to be computed at runtime.
 *
 * Headers we set on every response:
 *
 *   - Strict-Transport-Security      : 2y, includeSubDomains, preload
 *   - X-Content-Type-Options         : nosniff
 *   - Referrer-Policy                : strict-origin-when-cross-origin
 *   - Permissions-Policy             : opt out of every powerful API
 *   - Cross-Origin-Opener-Policy     : same-origin
 *   - Content-Security-Policy        : pragmatic CSP for Next.js + Supabase
 *
 * Routes that need to be embeddable (`/embed/*`) get a relaxed
 * `frame-ancestors *` and no `X-Frame-Options`. Everything else
 * gets `frame-ancestors 'self'` and `X-Frame-Options: DENY`.
 */
import { REQUEST_ID_HEADER } from "./obs/request-id";
import type { NextResponse } from "next/server";

const HSTS = "max-age=63072000; includeSubDomains; preload";

const PERMISSIONS = [
  "accelerometer=()",
  "autoplay=(self)",
  "camera=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=(self)",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "sync-xhr=()",
  "usb=()",
  "fullscreen=(self)",
].join(", ");

function connectSources(supabaseHost: string | null): string[] {
  const supabase = supabaseHost
    ? [`https://${supabaseHost}`, `wss://${supabaseHost}`]
    : [];
  // A plain-http Supabase URL is only ever a local stack (supabase CLI or the
  // smoke suite's fake); production URLs are https, so this adds nothing there.
  if (supabaseHost && process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://")) {
    supabase.push(`http://${supabaseHost}`);
  }
  return [
    "'self'",
    ...supabase,
    "https://*.upstash.io",
    "https://api-inference.huggingface.co",
    "https://huggingface.co",
    "https://vitals.vercel-insights.com",
    "https://vercel.live",
  ];
}

export const CSP_REPORT_PATH = "/api/csp-report";

function csp({
  supabaseHost,
  isEmbed,
  nonce,
}: {
  supabaseHost: string | null;
  isEmbed: boolean;
  nonce?: string;
}): string {
  const connect = connectSources(supabaseHost);
  const frameAncestors = isEmbed ? "*" : "'self'";
  // 'unsafe-inline' for scripts is regrettable but Next.js still
  // emits inline RSC payloads + chunked hydration code without
  // nonces in the App Router edge runtime. Tracking nonces /
  // strict-dynamic in v1.2 (ADR 0021 follow-up).
  return [
    // Next.js finds the per-request nonce by taking the first `script-src*` directive of the request's
    // Content-Security-Policy header, and middleware response headers are copied onto that request, so the ENFORCED
    // header must carry it for the report-only strict policy to get nonce-stamped scripts. `script-src-attr` is the
    // harmless carrier: a nonce never matches inline event-handler attributes, so this only forbids them (React emits none).
    ...(nonce ? [`script-src-attr 'nonce-${nonce}'`] : []),
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** The embeddable player lives at /s/<publicId>/embed (legacy /embed/* kept); nothing else may be framed. */
export function isEmbedPath(pathname: string): boolean {
  return pathname.startsWith("/embed/") || /^\/s\/[^/]+\/embed\/?$/.test(pathname);
}

/**
 * Strict nonce-based policy, shipped Report-Only next to the enforced one above. It drops 'unsafe-inline' and
 * 'unsafe-eval' for scripts; violations are POSTed to CSP_REPORT_PATH so we can see what would break before
 * enforcing it. Once the reports are quiet, promote this string to Content-Security-Policy.
 */
export function strictCsp({
  supabaseHost,
  isEmbed,
  nonce,
}: {
  supabaseHost: string | null;
  isEmbed: boolean;
  nonce: string;
}): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${isEmbed ? "*" : "'none'"}`,
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources(supabaseHost).join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    "report-to csp-endpoint",
  ].join("; ");
}

/** 128 random bits, base64. Works in the edge runtime and in node (vitest). */
export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

export function applySecurityHeaders(
  response: NextResponse,
  opts: { pathname: string; supabaseHost: string | null; requestId?: string; nonce?: string },
): NextResponse {
  const isEmbed = isEmbedPath(opts.pathname);
  if (opts.requestId) response.headers.set(REQUEST_ID_HEADER, opts.requestId);
  response.headers.set("Strict-Transport-Security", HSTS);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", PERMISSIONS);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set("Reporting-Endpoints", `csp-endpoint="${CSP_REPORT_PATH}"`);
  if (opts.nonce) {
    response.headers.set(
      "Content-Security-Policy-Report-Only",
      strictCsp({ supabaseHost: opts.supabaseHost, isEmbed, nonce: opts.nonce }),
    );
  }
  if (!isEmbed) {
    response.headers.set("X-Frame-Options", "DENY");
  } else {
    response.headers.delete("X-Frame-Options");
  }
  response.headers.set(
    "Content-Security-Policy",
    csp({ supabaseHost: opts.supabaseHost, isEmbed, nonce: opts.nonce }),
  );
  // Reviewer links carry a secret token in the URL: never leak it via Referer, never cache the page.
  if (/^\/(api\/)?native-review\//.test(opts.pathname)) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
  }
  return response;
}

export function supabaseHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
