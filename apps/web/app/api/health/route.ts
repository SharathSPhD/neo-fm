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
    // Supabase's gateway-level health endpoint. Sends the
    // publishable / anon key so the API gateway accepts the call.
    // (`/auth/v1/health` rejects without a key; `/rest/v1/` returns
    // a 200 with `{}` when the project is reachable.)
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
      signal: AbortSignal.timeout(800),
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "user-agent": "neo-fm-health/1.0",
      },
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
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "v1.1-deep-dive",
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
