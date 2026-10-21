#!/usr/bin/env node
/**
 * Uploads the /lab/showcase clips to R2 `showcase/` through POST /api/admin/showcase-mirror. No spend; existing objects are kept.
 *   POOL_BASE_URL=https://<prod> node scripts/showcase-upload.mjs /mnt/project-files/arena/showcase-audio
 */
import { readdirSync, readFileSync } from "node:fs";

const dir = process.argv[2];
const base = (process.env.POOL_BASE_URL ?? "").replace(/\/$/, "");
const secret = process.env[process.env.ADMIN_SECRET_ENV ?? "MA_PROD_ADMIN_SECRET"];
if (!dir || !base || !secret) { console.error("usage: POOL_BASE_URL=... node scripts/showcase-upload.mjs <dir>"); process.exit(1); }
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".mp3")).sort()) {
  const res = await fetch(`${base}/api/admin/showcase-mirror?name=${encodeURIComponent(f)}`, { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: readFileSync(`${dir}/${f}`) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) bad++;
  console.log(f, res.status, JSON.stringify(j));
}
process.exit(bad ? 1 : 0);
