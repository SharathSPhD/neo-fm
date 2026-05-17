/**
 * Edge-friendly IP rate limiter for /api/* routes.
 *
 * Strategy:
 *   - Prefer Upstash Redis REST when `UPSTASH_REDIS_REST_URL` +
 *     `UPSTASH_REDIS_REST_TOKEN` are set. Upstash works in the Vercel
 *     edge runtime over plain HTTPS; we never need ioredis. (Vercel
 *     deprecated Vercel KV in early 2025 in favor of Marketplace
 *     storage integrations; Upstash is the canonical successor.)
 *   - Fall back to a per-process in-memory bucket for local dev / when
 *     no Upstash creds are configured. Not durable across regions, but
 *     enough to keep the dev story smooth and to give CI a reliable
 *     deterministic 429 path.
 *
 * The limiter is a fixed-window counter (cheap, predictable). Keys are
 * scoped per IP per route prefix per minute, so a heavy /api/songs
 * caller doesn't burn a different user's /api/lyrics budget.
 *
 * Per-route limits (per IP, per minute):
 *   - /api/songs (POST)         : 6
 *   - /api/songs/.../publish    : 30
 *   - /api/songs/.../regenerate : 6
 *   - /api/lyrics               : 60
 *   - /api/p/*  (public reads)  : 120
 *   - everything else under /api: 120
 */
const DEFAULT_WINDOW_SECONDS = 60;

export type RateLimitRule = {
  /** Friendly identifier used in the bucket cache key. */
  bucket: string;
  /** Maximum requests per IP per window. */
  limit: number;
  /** Window size in seconds (default 60). */
  windowSeconds?: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
};

// Per-process in-memory store for the dev/fallback path. Map<key, {count, expiresAtMs}>.
const memBuckets = new Map<string, { count: number; expiresAtMs: number }>();

function clientIp(headers: Headers): string {
  // Standard proxy / Vercel edge headers, in priority order.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    headers.get("fly-client-ip") ??
    "unknown"
  );
}

export function pickRule(pathname: string): RateLimitRule {
  // POST /api/songs (creation) -- expensive, tight budget.
  if (/^\/api\/songs\/?$/.test(pathname)) {
    return { bucket: "songs:create", limit: 6 };
  }
  // Section regeneration -- same envelope as song creation.
  if (/^\/api\/songs\/[^/]+\/sections\/[^/]+\/regenerate\/?$/.test(pathname)) {
    return { bucket: "songs:regen", limit: 6 };
  }
  // Publish toggles -- light, but still owner-scoped, allow more.
  if (/^\/api\/songs\/[^/]+\/publish\/?$/.test(pathname)) {
    return { bucket: "songs:publish", limit: 30 };
  }
  // Anonymous-write endpoints: keep the budget low so a single host
  // can't fill the feedback table or the waitlist.
  if (/^\/api\/feedback\/?$/.test(pathname)) {
    return { bucket: "anon:feedback", limit: 6 };
  }
  if (/^\/api\/waitlist\/?$/.test(pathname)) {
    return { bucket: "anon:waitlist", limit: 10 };
  }
  // Cover art / variation / remix / stems are tier-gated; the request
  // is server-side expensive (HF + storage). Keep tight. v1.4 Sprint 3:
  // remix peers with variation in the same bucket so a user can't
  // round-trip "remix-from-public" to amplify their effective limit.
  if (/^\/api\/songs\/[^/]+\/(cover-art|variation|remix)\/?$/.test(pathname)) {
    return { bucket: "songs:gen-aux", limit: 6 };
  }
  // Public share-surface reads.
  if (pathname.startsWith("/api/p/")) {
    return { bucket: "public:read", limit: 120 };
  }
  // Lyric / preview / library + everything else.
  return { bucket: "api:default", limit: 60 };
}

async function upstashIncrement(
  key: string,
  windowSeconds: number,
): Promise<{ count: number; ttl: number } | null> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) return null;
  try {
    // Pipeline: INCR + EXPIRE NX + TTL. Upstash REST supports this with
    // a single POST to /pipeline.
    const res = await fetch(`${baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(windowSeconds), "NX"],
        ["TTL", key],
      ]),
      // Keep this snappy; do NOT make the user wait on a flaky Redis.
      signal: AbortSignal.timeout(150),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Array<{ result?: number | string }>;
    const count =
      typeof payload[0]?.result === "number" ? payload[0]!.result : -1;
    const ttl =
      typeof payload[2]?.result === "number" ? payload[2]!.result : windowSeconds;
    if (count < 0) return null;
    return { count, ttl: ttl > 0 ? ttl : windowSeconds };
  } catch {
    return null;
  }
}

function memIncrement(
  key: string,
  windowSeconds: number,
): { count: number; ttl: number } {
  const now = Date.now();
  const ent = memBuckets.get(key);
  if (!ent || ent.expiresAtMs <= now) {
    const expiresAtMs = now + windowSeconds * 1000;
    memBuckets.set(key, { count: 1, expiresAtMs });
    return { count: 1, ttl: windowSeconds };
  }
  ent.count += 1;
  return {
    count: ent.count,
    ttl: Math.max(1, Math.ceil((ent.expiresAtMs - now) / 1000)),
  };
}

export async function enforceRateLimit(
  req: { headers: Headers; nextUrl: URL; method: string },
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const windowSeconds = rule.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const ip = clientIp(req.headers);
  // Fixed-window key: bucket:ip:method:floor(now/window).
  // floor(now/window) means each window is its own key, which
  // auto-resets on rollover.
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${rule.bucket}:${ip}:${req.method}:${windowStart}`;
  const remote = await upstashIncrement(key, windowSeconds);
  const result = remote ?? memIncrement(key, windowSeconds);
  const remaining = Math.max(0, rule.limit - result.count);
  return {
    ok: result.count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetSeconds: result.ttl,
  };
}
