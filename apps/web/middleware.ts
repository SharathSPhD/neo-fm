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

import { enforceRateLimit, pickRule } from "./lib/rate-limit";
import type { Database } from "./lib/supabase/database.types";

export async function middleware(request: NextRequest) {
  // Per-IP edge rate-limit for /api/* (Sprint 4). Upstash when wired,
  // in-memory fallback otherwise. Static routes and Server Component
  // navigation are not rate-limited here -- they remain Supabase-quota
  // and DGX-worker bound at deeper layers.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const rule = pickRule(request.nextUrl.pathname);
    const verdict = await enforceRateLimit(request, rule);
    if (!verdict.ok) {
      return new NextResponse(
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
    }
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Don't take the whole site down because env isn't wired locally.
    return response;
  }

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

  // Touch the session so the cookie is refreshed if the access token is
  // about to expire.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Run on every route except Next's internal asset paths, the
    // unauthenticated healthcheck, and image/font/etc.
    "/((?!_next/static|_next/image|favicon.ico|api/healthz|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)",
  ],
};
