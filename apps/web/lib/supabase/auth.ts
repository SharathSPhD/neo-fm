/**
 * Auth helpers for server-side route handlers.
 *
 * `requireUser()` does the boring thing: reads the Supabase session from the
 * request cookies, returns a 401 NextResponse if absent, returns
 * `{ user, supabase }` otherwise. Use it as the first line of every protected
 * route.
 */
import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { createServerClient } from "./server";

export type SupabaseServerClient = ReturnType<typeof createServerClient>;

export type AuthedRequest = {
  user: User;
  supabase: SupabaseServerClient;
};

export async function requireUser(): Promise<AuthedRequest | NextResponse> {
  const supabase = createServerClient();
  // getUser() always validates the JWT with Supabase; do not trust getSession()
  // alone for authorization decisions.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
  }
  return { user: data.user, supabase };
}
