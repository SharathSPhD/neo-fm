/**
 * PII scrubbing for anything we log or store about an error. Errors regularly
 * embed emails, tokens, ids and URLs with query strings, so every free-text
 * field passes through here before it leaves the process. Conservative on
 * purpose: over-redacting an error message costs a little debuggability,
 * under-redacting leaks a user's data into a table operators can read.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Long opaque runs: API keys, session ids, signed-URL signatures, share tokens.
const OPAQUE = /\b[A-Za-z0-9_-]{32,}\b/g;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g;
const KEYED_SECRET = /\b(token|secret|password|passwd|apikey|api_key|authorization|cookie|sig|signature)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi;

export function scrubText(input: unknown, max = 500): string {
  if (typeof input !== "string") return "";
  let s = input;
  s = s.replace(JWT, "<jwt>");
  s = s.replace(BEARER, "$1 <redacted>");
  s = s.replace(KEYED_SECRET, "$1$2<redacted>");
  s = s.replace(EMAIL, "<email>");
  s = s.replace(UUID, "<uuid>");
  s = s.replace(IPV4, "<ip>");
  s = s.replace(PHONE, "<phone>");
  s = s.replace(OPAQUE, "<token>");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Keep only the path: drops host, query string and fragment (they carry tokens, search text, share links). */
export function scrubUrl(input: unknown, max = 200): string {
  if (typeof input !== "string" || input.length === 0) return "";
  let path = input;
  try {
    path = new URL(input, "https://placeholder.invalid").pathname;
  } catch {
    path = input.split(/[?#]/)[0] ?? "";
  }
  // Path segments can hold public ids / handles / review tokens.
  const segs = path.split("/").map((seg) => (seg.length > 0 && /^[A-Za-z0-9_-]{10,}$/.test(seg) && /\d/.test(seg) ? ":id" : seg));
  return scrubText(segs.join("/"), max);
}

/** Stack traces: keep frames, drop absolute origins and query strings, cap the depth. */
export function scrubStack(input: unknown, maxFrames = 12, maxChars = 2000): string {
  if (typeof input !== "string") return "";
  const lines = input.split("\n").slice(0, maxFrames + 1).map((l) =>
    scrubText(l.replace(/https?:\/\/[^/\s)]+/g, "").replace(/\?[^\s):]*/g, ""), 300),
  );
  const out = lines.join("\n");
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

const SENSITIVE_KEY = /^(email|password|passwd|token|secret|authorization|cookie|set-cookie|api[_-]?key|session|prompt|lyrics|body)$/i;

/** Redacts known-sensitive keys and scrubs string values of an arbitrary log-fields object (shallow + one level). */
export function scrubFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(k)) out[k] = "<redacted>";
    else if (typeof v === "string") out[k] = scrubText(v, 1000);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = scrubFields(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}
