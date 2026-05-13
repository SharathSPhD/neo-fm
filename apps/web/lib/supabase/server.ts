/**
 * Supabase server-side client factory.
 *
 * Three flavors:
 *
 * - `createServerClient()`  — request-bound user client. Reads/writes cookies
 *   through the Next.js App Router's `cookies()` adapter. Use this in every
 *   route that needs to act AS the user (PostgREST applies RLS).
 *
 * - `createServiceRoleClient()` — uses the secret service-role key. Bypasses
 *   RLS. Use only for trusted server-only operations that need full access
 *   (e.g. enqueueing into pgmq, minting signed URLs on behalf of a user
 *   we have already authenticated separately).
 *
 * Never import this file from a `"use client"` module — Next's tree-shaker
 * does NOT prevent the service-role key from leaking into the browser
 * bundle. The hard guard is the `import "server-only"` line below.
 */
import "server-only";

import { createServerClient as createSsrServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "./database.types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// The Vercel <> Supabase marketplace integration provisions
// `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Newer Supabase projects also expose a
// "publishable" key under `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; we accept
// either to stay compatible with both the integration default and manual
// .env wiring.
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. ` +
        `Set it in Vercel project env (production + preview + development) ` +
        `or in apps/web/.env.local for local dev.`,
    );
  }
  return value;
}

export function createServerClient() {
  const cookieStore = cookies();
  return createSsrServerClient<Database>(
    assertEnv(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    assertEnv(
      SUPABASE_PUBLISHABLE_KEY,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    ),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // In route handlers that do not allow cookie writes (e.g. when
            // called from a Server Component without an attached response),
            // setAll throws. We swallow because the caller is read-only;
            // session refresh writes happen in middleware.
          }
        },
      },
    },
  );
}

/**
 * Returns a Supabase client authenticated with the service-role key.
 *
 * CRITICAL: never expose the returned client (or any data derived from it
 * with `service_role` privileges) to the browser. Use this only for the
 * narrow set of operations that genuinely need to bypass RLS.
 */
export function createServiceRoleClient() {
  return createClient<Database>(
    assertEnv(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    assertEnv(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
