import { createHmac } from "node:crypto";

/** Short-lived scoped token for the embedding service (see services/embedder/app.py `_authorized`). */
export function mintEmbedToken(master: string, ttlSeconds = 1800, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = createHmac("sha256", master).update(`v1.${exp}`).digest("hex");
  return `v1.${exp}.${sig}`;
}
