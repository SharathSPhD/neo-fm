/**
 * Browser-side Supabase client factory. Use this in `"use client"` modules
 * for auth UI (sign in / sign out / password reset) and for any user-scoped
 * data access the client truly needs.
 *
 * For protected reads/writes, prefer the server-side `createServerClient()`
 * inside a route handler or Server Component; it carries the session via
 * cookies and applies RLS automatically.
 */
import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Accept both the Vercel-Supabase integration default
  // (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and the newer publishable key naming.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createBrowserClient<Database>(url, key);
}
