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

function csp({
  supabaseHost,
  isEmbed,
}: {
  supabaseHost: string | null;
  isEmbed: boolean;
}): string {
  const supabase = supabaseHost
    ? [`https://${supabaseHost}`, `wss://${supabaseHost}`]
    : [];
  const connect = [
    "'self'",
    ...supabase,
    "https://*.upstash.io",
    "https://api-inference.huggingface.co",
    "https://huggingface.co",
    "https://vitals.vercel-insights.com",
    "https://vercel.live",
  ];
  const frameAncestors = isEmbed ? "*" : "'self'";
  // 'unsafe-inline' for scripts is regrettable but Next.js still
  // emits inline RSC payloads + chunked hydration code without
  // nonces in the App Router edge runtime. Tracking nonces /
  // strict-dynamic in v1.2 (ADR 0021 follow-up).
  return [
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

export function applySecurityHeaders(
  response: NextResponse,
  opts: { pathname: string; supabaseHost: string | null },
): NextResponse {
  const isEmbed = opts.pathname.startsWith("/embed/");
  response.headers.set("Strict-Transport-Security", HSTS);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", PERMISSIONS);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (!isEmbed) {
    response.headers.set("X-Frame-Options", "DENY");
  } else {
    response.headers.delete("X-Frame-Options");
  }
  response.headers.set(
    "Content-Security-Policy",
    csp({ supabaseHost: opts.supabaseHost, isEmbed }),
  );
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
