#!/usr/bin/env node
/**
 * Copies admitted station-pool audio from Supabase Storage to a Cloudflare R2 bucket (same object keys), so the queue
 * route can serve it from POOL_CDN_BASE. Idempotent: objects already in R2 (HEAD 200) are skipped. Dry run unless --apply.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 * Read-only on Supabase. Never prints secrets.
 */
import { createHash, createHmac } from "node:crypto";

const env = (k) => process.env[k] || (console.error(`missing ${k}`), process.exit(2));
const apply = process.argv.includes("--apply");
const sb = env("SUPABASE_URL").replace(/\/$/, "");
const sbKey = env("SUPABASE_SERVICE_ROLE_KEY");
const acct = env("R2_ACCOUNT_ID"), bucket = env("R2_BUCKET"), ak = env("R2_ACCESS_KEY_ID"), sk = env("R2_SECRET_ACCESS_KEY");
const host = `${acct}.r2.cloudflarestorage.com`;

const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
const sha = (d) => createHash("sha256").update(d).digest("hex");

async function r2(method, key, body) {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const path = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payload = body ? sha(body) : sha("");
  const headers = { host, "x-amz-content-sha256": payload, "x-amz-date": now, ...(body ? { "content-type": "audio/mpeg" } : {}) };
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, "", ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payload].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha(canonical)].join("\n");
  const sig = createHmac("sha256", hmac(hmac(hmac(hmac(`AWS4${sk}`, day), "auto"), "s3"), "aws4_request")).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${sig}`;
  return fetch(`https://${host}${path}`, { method, headers, body });
}

const rows = await (await fetch(`${sb}/rest/v1/pool_tracks?select=audio_path&status=eq.admitted`, { headers: { apikey: sbKey, authorization: `Bearer ${sbKey}` } })).json();
if (!Array.isArray(rows)) { console.error("pool_tracks read failed"); process.exit(1); }
let copied = 0, skipped = 0, failed = 0;
for (const { audio_path } of rows) {
  const key = audio_path.replace(/^tracks\//, "");
  if ((await r2("HEAD", key)).status === 200) { skipped++; continue; }
  if (!apply) { console.log("would copy", key); continue; }
  const src = await fetch(`${sb}/storage/v1/object/tracks/${key.split("/").map(encodeURIComponent).join("/")}`, { headers: { apikey: sbKey, authorization: `Bearer ${sbKey}` } });
  if (!src.ok) { failed++; console.error("read failed", key, src.status); continue; }
  const put = await r2("PUT", key, Buffer.from(await src.arrayBuffer()));
  if (put.ok) copied++; else { failed++; console.error("put failed", key, put.status); }
}
console.log(JSON.stringify({ total: rows.length, copied, skipped, failed, apply }));
