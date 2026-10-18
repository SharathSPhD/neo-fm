import { createHmac } from "node:crypto";

/**
 * Short-lived scoped token for the embedding service (see services/embedder/app.py `_authorized`).
 * With a `scope` (a job id) it is `v2.<exp>.<scope>.<sig>` so a leaked token is attributable to one job; without,
 * the original `v1.<exp>.<sig>`. The embedder accepts both.
 */
export function mintEmbedToken(master: string, ttlSeconds = 1800, now = Date.now(), scope?: string): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  if (scope && /^[A-Za-z0-9_-]{1,64}$/.test(scope)) {
    const sig = createHmac("sha256", master).update(`v2.${exp}.${scope}`).digest("hex");
    return `v2.${exp}.${scope}.${sig}`;
  }
  const sig = createHmac("sha256", master).update(`v1.${exp}`).digest("hex");
  return `v1.${exp}.${sig}`;
}
