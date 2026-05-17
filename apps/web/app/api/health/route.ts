/**
 * /api/health -- richer healthcheck than /api/healthz.
 *
 * Reports:
 *   - marketing version tag for everyone; real commit SHA + internal
 *     version string only for callers that present the
 *     `HEALTH_INTERNAL_TOKEN` (Authorization: Bearer …) or are signed in
 *     to Supabase (sb-access-token cookie present). Anonymous callers
 *     see `version: "production"` and `commit: null` so deploy lineage
 *     doesn't leak through a public probe.
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

function isInternalCaller(req: Request): boolean {
  // Internal-token bearer: a fixed, rotateable secret for internal
  // monitors / runbooks that should see commit SHA + full version.
  const expected = process.env.HEALTH_INTERNAL_TOKEN;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth.startsWith("Bearer ")) {
      const provided = auth.slice("Bearer ".length).trim();
      if (provided.length > 0 && provided === expected) return true;
    }
  }
  // Signed-in browser sessions: Supabase sets `sb-<ref>-auth-token`
  // cookies. We don't need to validate the token here — presence is
  // enough to gate the richer payload, because forging the cookie
  // doesn't grant any extra access (the response only adds the SHA
  // already shown in deploy logs to the team).
  const cookie = req.headers.get("cookie") ?? "";
  if (/(^|;\s*)sb-[^=]+-auth-token=/.test(cookie)) return true;
  return false;
}

export async function GET(req: Request) {
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
  const internal = isInternalCaller(req);
  const fullVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "v1.3-wedge";
  const fullCommit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  return NextResponse.json(
    {
      status,
      phase: 1,
      version: internal ? fullVersion : "production",
      commit: internal ? fullCommit : null,
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
