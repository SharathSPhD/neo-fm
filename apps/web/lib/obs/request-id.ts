/**
 * Request correlation ids. Middleware stamps every request/response with
 * `x-request-id`; route handlers read it back so a log line, a 429 and a
 * stored client error can all be matched to the same request.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a well-formed incoming id (e.g. from an upstream proxy), otherwise mints one. Never trusts arbitrary input. */
export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  if (incoming && SAFE_ID.test(incoming)) return incoming;
  return crypto.randomUUID();
}

export function requestIdOf(req: { headers: Headers }): string | undefined {
  const v = req.headers.get(REQUEST_ID_HEADER);
  return v && SAFE_ID.test(v) ? v : undefined;
}
