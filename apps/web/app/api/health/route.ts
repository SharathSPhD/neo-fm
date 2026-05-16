/**
 * /api/health -- richer healthcheck than /api/healthz.
 *
 * Reports:
 *   - app version + commit sha (from Vercel env when deployed)
 *   - supabase reachability (cheap SELECT 1 via the publishable client)
 *   - upstash reachability when configured
 *   - boot timestamp
 *
 * Never exposes secrets. Always returns 200 with a JSON payload so
 * uptime probes can grep for status fields rather than relying on a
 * 200/500 split; that lets us catch "degraded" without paging on a
 * full outage. /api/healthz remains the lightweight liveness probe.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function checkSupabase(): Promise<{
  status: "ok" | "degraded" | "missing";
  latencyMs: number | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { status: "missing", latencyMs: null };
  const t0 = Date.now();
  try {
    // Supabase's `/auth/v1/settings` returns 200 + JSON when the
    // project is reachable and the publishable / anon key is
    // accepted. (`/auth/v1/health` and `/rest/v1/` both require a
    // secret key, so they can't double as anon-callable probes.)
    const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
      signal: AbortSignal.timeout(800),
      headers: { apikey: key, "user-agent": "neo-fm-health/1.0" },
    });
    if (!res.ok) return { status: "degraded", latencyMs: Date.now() - t0 };
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch {
    return { status: "degraded", latencyMs: Date.now() - t0 };
  }
}

async function checkUpstash(): Promise<{
  status: "ok" | "degraded" | "missing";
  latencyMs: number | null;
}> {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return { status: "missing", latencyMs: null };
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return { status: "degraded", latencyMs: Date.now() - t0 };
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch {
    return { status: "degraded", latencyMs: Date.now() - t0 };
  }
}

export async function GET() {
  const [supabaseRes, upstashRes] = await Promise.all([
    checkSupabase(),
    checkUpstash(),
  ]);
  const status =
    supabaseRes.status === "ok"
      ? "ok"
      : supabaseRes.status === "missing"
        ? "missing"
        : "degraded";
  return NextResponse.json(
    {
      status,
      phase: 1,
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "v1.2-bugfix-pack",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      checks: {
        supabase: supabaseRes,
        upstash: upstashRes,
      },
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
