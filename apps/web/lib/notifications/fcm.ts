/**
 * Native push for the Android app through Firebase Cloud Messaging (HTTP v1), on node:crypto only: no extra dependency.
 * Off unless NEO_FM_NATIVE_PUSH_ENABLED=true AND FCM_SERVICE_ACCOUNT_JSON (the service account key, raw or base64) is set;
 * every caller goes through `fcmConfig()`. Mirrors lib/notifications/push.ts, which does the same for browsers.
 */
import { createSign } from "node:crypto";

import type { PushResult } from "./push";

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export function fcmConfig(env: NodeJS.ProcessEnv = process.env): FcmConfig | null {
  if (env.NEO_FM_NATIVE_PUSH_ENABLED !== "true") return null;
  const raw = (env.FCM_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const j = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string };
    if (!j.project_id || !j.client_email || !j.private_key?.includes("PRIVATE KEY")) return null;
    return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
  } catch {
    return null;
  }
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cached: { key: string; token: string; exp: number } | null = null;

/** OAuth2 access token for the service account (JWT bearer grant), cached until a minute before it expires. */
export async function fcmAccessToken(cfg: FcmConfig, f: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  if (cached && cached.key === cfg.clientEmail && cached.exp - 60_000 > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const input = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(
    JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
  )}`;
  const sig = createSign("RSA-SHA256").update(input).sign(cfg.privateKey);
  try {
    const res = await f(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${b64u(sig)}` }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    cached = { key: cfg.clientEmail, token: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  } catch {
    return null;
  }
}

/** Sends one notification to one app install. UNREGISTERED (404) means the token is dead and should be deleted. */
export async function sendNative(
  cfg: FcmConfig,
  token: string,
  message: { title: string; body?: string; url: string; tag?: string },
  f: typeof fetch = fetch,
): Promise<PushResult> {
  const access = await fcmAccessToken(cfg, f);
  if (!access) return "failed";
  try {
    const res = await f(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, ...(message.body ? { body: message.body } : {}) },
          data: { url: message.url, ...(message.tag ? { tag: message.tag } : {}) },
          android: { priority: "HIGH", ttl: "86400s", ...(message.tag ? { collapse_key: message.tag } : {}) },
        },
      }),
    });
    if (res.ok) return "sent";
    if (res.status === 404) return "gone";
    return "failed";
  } catch {
    return "failed";
  }
}
