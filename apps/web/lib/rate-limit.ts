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
 *   - /auth/*, /sign-out      : 30
 *   - /sign-in, /sign-up (POST): 10
 *   - /api/report              : 5
 *   - /api/client-errors       : 10
 *   - /api/events              : 20
 *   - native-review ratings API and /native-review/<token> page : 30
 *   - /api/songs (POST)         : 6
 *   - /api/songs/.../publish    : 30
 *   - /api/songs/.../regenerate : 6
 *   - /api/lyrics               : 60
 *   - /api/station/queue        : 30 (open to signed-out visitors)
 *   - /api/station/signal       : 90
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

/**
 * Pick the budget for a request, or `null` when the route is not limited
 * (e.g. GET page views of the sign-in / sign-up forms).
 */
export function pickRule(
  pathname: string,
  method: string = "POST",
): RateLimitRule | null {
  const m = method.toUpperCase();
  const isRead = m === "GET" || m === "HEAD";
  // Auth surface: the OAuth/magic-link callback and sign-out sit outside
  // /api, so they need explicit coverage. Tight enough to blunt code
  // guessing and mail-bombing, loose enough for a shared NAT.
  if (/^\/auth\//.test(pathname) || pathname === "/sign-out") {
    return { bucket: "auth:flow", limit: 30 };
  }
  if (pathname === "/sign-in" || pathname === "/sign-up") {
    return isRead ? null : { bucket: "auth:submit", limit: 10 };
  }
  // Browser error reports: anonymous and cheap to spam, and a crash loop can
  // legitimately send a few, so keep it tight but not zero.
  if (/^\/api\/client-errors\/?$/.test(pathname)) {
    return { bucket: "anon:client-errors", limit: 10 };
  }
  // Anonymous client telemetry: cheap per call but unauthenticated.
  if (/^\/api\/events\/?$/.test(pathname)) {
    return { bucket: "anon:events", limit: 20 };
  }
  // Native-review links are token-gated, not login-gated, so cap both the
  // rating writes and the page itself to blunt token guessing.
  if (/^\/api\/native-review\/[^/]+\/ratings\/?$/.test(pathname)) {
    return { bucket: "review:rate", limit: 30 };
  }
  if (/^\/native-review\/[^/]+\/?$/.test(pathname)) {
    return { bucket: "review:page", limit: 30 };
  }
  // UI-translation review links are token-gated like native-review. A reviewer saves one verdict per string
  // (hundreds per session), so writes get a higher cap than the page itself.
  if (/^\/api\/ui-review\/[^/]+\/items\/?$/.test(pathname)) {
    return { bucket: "uireview:write", limit: 120 };
  }
  if (/^\/ui-review\/[^/]+(\/open)?\/?$/.test(pathname)) {
    return { bucket: "uireview:page", limit: 30 };
  }
  // Browser CSP violation reports: anonymous and unbounded in a hostile page, so cap hard.
  if (/^\/api\/csp-report\/?$/.test(pathname)) {
    return { bucket: "anon:csp", limit: 30 };
  }
  // Public abuse reports are anonymous writes into a moderation queue.
  if (/^\/api\/report\/?$/.test(pathname)) {
    return { bucket: "anon:report", limit: 5 };
  }
  // Only the POST creates a song; listing (GET /api/songs) must not burn
  // the generation budget.
  if (/^\/api\/songs\/?$/.test(pathname)) {
    return isRead
      ? { bucket: "api:default", limit: 60 }
      : { bucket: "songs:create", limit: 6 };
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
  // The station queue is open to signed-out visitors and signs a URL per track, so cap it per IP. A listener refills
  // about once per ten tracks, plus a few steering taps, so 30 a minute leaves a shared NAT plenty of room.
  if (/^\/api\/station\/queue\/?$/.test(pathname)) {
    return { bucket: "station:queue", limit: 30 };
  }
  // Listener signals are an authenticated write into station_signals. A listener sends a handful a minute even
  // when skipping fast; the own bucket keeps them off the shared api:default budget, and 90 leaves room for a
  // shared NAT while still capping a looping or hostile client.
  if (/^\/api\/station\/signal\/?$/.test(pathname)) {
    return { bucket: "station:signal", limit: 90 };
  }
  // Anonymous listener counters: write-only, so keep the budget lower than reads.
  if (/^\/api\/p\/[^/]+\/listen\/?$/.test(pathname)) {
    return { bucket: "public:listen", limit: 30 };
  }
  // Public share-surface reads.
  if (pathname.startsWith("/api/p/") || pathname === "/api/oembed") {
    return { bucket: "public:read", limit: 120 };
  }
  // Lyric / preview / library + everything else under /api. Pages, RSC
  // payloads and prefetches (any non-/api path) are not limited here: one
  // navigation fires several requests and would exhaust a shared budget.
  return pathname.startsWith("/api/") ? { bucket: "api:default", limit: 60 } : null;
}

async function upstashIncrement(
  key: string,
  windowSeconds: number,
): Promise<{ count: number; ttl: number } | null> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) return null;
  if (Date.now() < upstashDownUntilMs) return null;
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
    if (!res.ok) {
      upstashDownUntilMs = Date.now() + UPSTASH_COOLDOWN_MS;
      return null;
    }
    const payload = (await res.json()) as Array<{ result?: number | string }>;
    const count =
      typeof payload[0]?.result === "number" ? payload[0]!.result : -1;
    const ttl =
      typeof payload[2]?.result === "number" ? payload[2]!.result : windowSeconds;
    if (count < 0) return null;
    return { count, ttl: ttl > 0 ? ttl : windowSeconds };
  } catch {
    upstashDownUntilMs = Date.now() + UPSTASH_COOLDOWN_MS;
    return null;
  }
}

// After an Upstash failure, skip it briefly so a Redis outage costs one
// timeout per cooldown instead of 150ms on every request.
const UPSTASH_COOLDOWN_MS = 10_000;
let upstashDownUntilMs = 0;
const MEM_SWEEP_THRESHOLD = 5_000;

/** Test hook: clear in-memory state and the circuit breaker. */
export function __resetRateLimitState(): void {
  memBuckets.clear();
  upstashDownUntilMs = 0;
}

function memIncrement(
  key: string,
  windowSeconds: number,
): { count: number; ttl: number } {
  const now = Date.now();
  if (memBuckets.size > MEM_SWEEP_THRESHOLD) {
    for (const [k, v] of memBuckets) {
      if (v.expiresAtMs <= now) memBuckets.delete(k);
    }
  }
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
