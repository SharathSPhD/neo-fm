import { mintEmbedToken } from "./embed-token";

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/**
 * EMBED_URL is operator-set, but it is handed to a sandbox that runs model-written code, so refuse anything that
 * could point it (or the app) at internal infrastructure: https only, no credentials, no localhost / private /
 * link-local / metadata addresses or internal-only suffixes. Returns the normalised origin, or undefined.
 */
export function safeEmbedUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return undefined; }
  if (u.protocol !== "https:" || u.username || u.password) return undefined;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || /\.(local|internal|localdomain|lan|home)$/.test(host)) return undefined;
  if (host.includes(":")) return undefined; // IPv6 literals: loopback/ULA/link-local are not worth enumerating, a real service has a DNS name
  if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x/i.test(host)) { if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) || PRIVATE_V4.some((r) => r.test(host))) return undefined; }
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/** Embedder endpoint + a short-lived token scoped to `scope` (e.g. a job id), or undefined when not configured or unsafe. */
export function embedEngine(scope?: string, ttlSeconds?: number, env = process.env): { url: string; token: string } | undefined {
  const url = safeEmbedUrl(env.EMBED_URL);
  const master = env.EMBED_TOKEN?.trim();
  if (!url || !master) return undefined;
  return { url, token: mintEmbedToken(master, ttlSeconds, Date.now(), scope) };
}

/**
 * What to record as the embedder used for a finished song. The embedder is best-effort: if the service refuses the
 * job token (for example an embedder build that predates v2 job-bound tokens) or is down, the engine falls back to
 * its lexical embedder and the song still completes; telemetry then says "none" instead of claiming "service".
 */
export function embedderUsed(configured: boolean, cascade: { embedder?: unknown } | null | undefined): "service" | "none" {
  if (!configured) return "none";
  const used = cascade?.embedder;
  if (typeof used === "string" && !used.endsWith("@service")) return "none";
  return "service";
}
