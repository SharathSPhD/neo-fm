/**
 * GET /auth/callback
 *
 * Supabase's email-confirmation, magic-link, and OAuth flows all bounce
 * the user back to a redirect URL with either a `code` (PKCE flow) or
 * an `error_description` (failure). This handler exchanges the code
 * for a session via `@supabase/ssr` so the auth cookie is set on the
 * Vercel-served response, then 302s to the next-page (default
 * `/library`).
 *
 * Why this route exists in v1.1: the v1 sign-up form did not pass
 * `emailRedirectTo`, so confirmation links landed on Supabase's Site
 * URL (or our root) without a real session-exchange path. Combined
 * with Vercel deployment protection this produced the user-reported
 * (a) bug ("link goes to Vercel login wall"). This handler is the
 * Vercel-side half of the fix; the project-side half is documented in
 * `docs/REVIEWS/security.md §3.1` and `docs/SECURITY.md` (Sprint J).
 *
 * Defenses:
 *
 * - `next` is sanitized to same-origin paths only; anything else
 *   falls back to `/library`. This prevents open-redirect abuse via
 *   `…/auth/callback?next=https://evil.example`.
 * - Errors are rendered as a friendly redirect to /sign-in with an
 *   `error_description` query param so the sign-in form can surface
 *   it to the user without exposing tokens.
 * - Cookie writes go through @supabase/ssr's adapter which handles
 *   the production HttpOnly / SameSite=Lax settings.
 */
import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function sanitizeNext(raw: string | null): string {
  if (!raw) return "/library";
  if (!raw.startsWith("/")) return "/library";
  if (raw.startsWith("//")) return "/library";
  return raw;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorDescription = url.searchParams.get("error_description");
  const next = sanitizeNext(url.searchParams.get("next"));

  // Build the absolute destination off the request's actual host so
  // the redirect lands on the same deployment that handled the
  // callback (production -> production, preview -> preview).
  const baseUrl = new URL(request.url);
  baseUrl.search = "";

  if (errorDescription) {
    const signIn = new URL("/sign-in", baseUrl);
    signIn.searchParams.set("error_description", errorDescription);
    return NextResponse.redirect(signIn, { status: 303 });
  }

  if (!code) {
    // No code, no error — visitor hit /auth/callback directly. Send
    // them to sign-in.
    return NextResponse.redirect(new URL("/sign-in", baseUrl), { status: 303 });
  }

  const supabase = createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const signIn = new URL("/sign-in", baseUrl);
    signIn.searchParams.set("error_description", error.message);
    return NextResponse.redirect(signIn, { status: 303 });
  }

  const dest = new URL(next, baseUrl);
  return NextResponse.redirect(dest, { status: 303 });
}
