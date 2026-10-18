import { createHash, createHmac } from "node:crypto";

/** Minimal SigV4 client for the Cloudflare R2 S3 endpoint (HEAD and PUT of pool audio). Never logs credentials. */
export type R2Env = Record<string, string | undefined>;

export function r2Configured(env: R2Env = process.env): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

const hmac = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();
const sha = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");

export function r2Key(audioPath: string): string {
  return audioPath.replace(/^tracks\//, "").replace(/^\/+/, "");
}

export async function r2Request(method: "HEAD" | "PUT", key: string, body?: Buffer, env: R2Env = process.env, now = new Date()): Promise<Response> {
  const { R2_ACCOUNT_ID: acct, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk } = env;
  if (!acct || !bucket || !ak || !sk) throw new Error("R2 env not configured");
  const host = `${acct}.r2.cloudflarestorage.com`;
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const path = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payload = sha(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": stamp, ...(body ? { "content-type": "audio/mpeg" } : {}) };
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, "", ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payload].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha(canonical)].join("\n");
  const sig = createHmac("sha256", hmac(hmac(hmac(hmac(`AWS4${sk}`, day), "auto"), "s3"), "aws4_request")).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${sig}`;
  const { host: _host, ...sendHeaders } = headers;
  return fetch(`https://${host}${path}`, { method, headers: sendHeaders, body: body ? new Uint8Array(body) : undefined, cache: "no-store" });
}
