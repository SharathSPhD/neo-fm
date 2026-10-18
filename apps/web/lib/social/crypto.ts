import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Refresh tokens are stored sealed (AES-256-GCM) with SOCIAL_TOKEN_KEY: 32 random bytes, base64. */
function key(env: NodeJS.ProcessEnv): Buffer {
  const k = Buffer.from((env.SOCIAL_TOKEN_KEY ?? "").trim(), "base64");
  if (k.length !== 32) throw new Error("SOCIAL_TOKEN_KEY must be 32 bytes, base64");
  return k;
}

export function seal(plain: string, env = process.env): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(env), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function open(sealed: string, env = process.env): string {
  const buf = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", key(env), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** OAuth `state`: platform + expiry, HMAC-signed so the callback needs no session. */
export function signState(platform: string, secret: string, now = Date.now(), ttlMs = 10 * 60_000, extra: StateExtra = {}): string {
  const payload = Buffer.from(JSON.stringify({ ...extra, p: platform, e: now + ttlMs, n: randomBytes(6).toString("hex") })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyState(state: string, platform: string, secret: string, now = Date.now()): boolean {
  return readState(state, platform, secret, now) !== null;
}

/** Listener connects carry the signed-in user (`u`) and credential mode (`m`) so the callback needs no session cookie. */
export interface StateExtra {
  u?: string;
  m?: "neofm_app" | "own_app";
}

/** Verified payload, or null when the signature, platform or expiry is wrong. */
export function readState(state: string, platform: string, secret: string, now = Date.now()): StateExtra | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig || !secret) return null;
  const want = createHmac("sha256", secret).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StateExtra & { p: string; e: number };
    return p.p === platform && p.e > now ? { u: p.u, m: p.m } : null;
  } catch {
    return null;
  }
}
