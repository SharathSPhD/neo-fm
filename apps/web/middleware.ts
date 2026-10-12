/**
 * Session-refresh middleware for the Next.js App Router.
 *
 * Supabase access tokens expire every hour. The browser client keeps them
 * refreshed during interactive use, but server-rendered pages need a hook
 * to refresh the cookie on each request. We do that here so that:
 *
 *   - protected route handlers see a valid JWT in `requireUser()`
 *   - Server Components see a logged-in user inside `createServerClient()`
 *
 * Anything under /_next, /api/healthz, static assets, and favicon is
 * exempt -- they don't need a session.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { resolveRequestId, REQUEST_ID_HEADER } from "./lib/obs/request-id";
import { enforceRateLimit, pickRule } from "./lib/rate-limit";
import { applySecurityHeaders, CSP_REPORT_PATH, newNonce, strictCsp, isEmbedPath, supabaseHost } from "./lib/security-headers";
import type { Database } from "./lib/supabase/database.types";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Correlation id: forwarded to route handlers (request header) and echoed on every response.
  const requestId = resolveRequestId(request.headers);
  // Mutate (not copy) so the Supabase cookie refresh below still reaches route handlers via the same headers object.
  request.headers.set(REQUEST_ID_HEADER, requestId);
  const sbHost = supabaseHost();

  // Per-IP edge rate-limit for /api/* plus the auth surface (Sprint 4). Upstash when wired,
  // in-memory fallback otherwise. Static routes and Server Component
  // navigation are not rate-limited here -- they remain Supabase-quota
  // and DGX-worker bound at deeper layers.
  const rule = pickRule(pathname, request.method);
  if (rule) {
    const verdict = await enforceRateLimit(request, rule);
    if (!verdict.ok) {
      const blocked = new NextResponse(
        JSON.stringify({
          error: "rate_limited",
          retry_after_seconds: verdict.resetSeconds,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(verdict.resetSeconds),
            "x-ratelimit-limit": String(verdict.limit),
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(verdict.resetSeconds),
          },
        },
      );
      return applySecurityHeaders(blocked, {
        pathname,
        supabaseHost: sbHost,
        requestId,
      });
    }
  }

  // Per-request nonce: Next reads it from the request's CSP header and stamps its own inline scripts.
  const nonce = newNonce();
  // Mutate (not copy), same reason as the request id above.
  request.headers.set("x-nonce", nonce);
  request.headers.set(
    "content-security-policy-report-only",
    strictCsp({ supabaseHost: sbHost, isEmbed: isEmbedPath(pathname), nonce }),
  );
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Don't take the whole site down because env isn't wired locally.
    return applySecurityHeaders(response, { pathname, supabaseHost: sbHost, nonce, requestId });
  }

  // Skip the session-touch for healthchecks so they stay cheap and
  // don't allocate a Supabase client per probe.
  const skipAuth = pathname === "/api/healthz" || pathname === "/api/health" || pathname === CSP_REPORT_PATH;
  if (!skipAuth) {
    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          toSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    await supabase.auth.getUser();
  }

  return applySecurityHeaders(response, { pathname, supabaseHost: sbHost, nonce, requestId });
}

export const config = {
  matcher: [
    // Run on every route except Next's internal asset paths and
    // image/font/etc. We *do* keep /api/health(z) in the matcher
    // because security headers should still apply there, but the
    // handler above bypasses the auth touch for both.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)",
  ],
};
