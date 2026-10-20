import { createHash, createHmac } from "node:crypto";

/** Minimal SigV4 client for the Cloudflare R2 S3 endpoint (HEAD and PUT of pool audio). Never logs credentials. */
export type R2Env = Record<string, string | undefined>;

export function r2Configured(env: R2Env = process.env): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

const hmac = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();
const sha = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");

/** Pool tracks never change once mirrored (the mirror skips keys already in R2), so browsers and the CDN may cache them for a year. */
export const POOL_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function r2Key(audioPath: string): string {
  return audioPath.replace(/^tracks\//, "").replace(/^\/+/, "");
}

export async function r2Request(method: "HEAD" | "PUT", key: string, body?: Buffer, env: R2Env = process.env, now = new Date(), extra: Record<string, string> = {}): Promise<Response> {
  const { R2_ACCOUNT_ID: acct, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk } = env;
  if (!acct || !bucket || !ak || !sk) throw new Error("R2 env not configured");
  const host = `${acct}.r2.cloudflarestorage.com`;
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const path = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payload = sha(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": stamp, ...(body ? { "content-type": "audio/mpeg", "cache-control": POOL_CACHE_CONTROL } : {}), ...extra };
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, "", ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payload].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha(canonical)].join("\n");
  const sig = createHmac("sha256", hmac(hmac(hmac(hmac(`AWS4${sk}`, day), "auto"), "s3"), "aws4_request")).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${sig}`;
  const { host: _host, ...sendHeaders } = headers;
  return fetch(`https://${host}${path}`, { method, headers: sendHeaders, body: body ? new Uint8Array(body) : undefined, cache: "no-store" });
}

/**
 * Rewrites an existing object's Cache-Control in place (S3 CopyObject onto itself with the REPLACE directive), keeping its
 * audio content type. Used to backfill objects that were uploaded before PUTs carried Cache-Control.
 */
export function r2SetPoolCacheControl(key: string, env: R2Env = process.env, now = new Date()): Promise<Response> {
  return r2Request("PUT", key, undefined, env, now, {
    "x-amz-copy-source": `/${env.R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`,
    "x-amz-metadata-directive": "REPLACE",
    "content-type": "audio/mpeg",
    "cache-control": POOL_CACHE_CONTROL,
  });
}
