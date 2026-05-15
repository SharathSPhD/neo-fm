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

import type { Database } from "./lib/supabase/database.types";

export async function middleware(request: NextRequest) {
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
