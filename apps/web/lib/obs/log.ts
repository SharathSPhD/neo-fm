/**
 * Structured server logging: one JSON object per line on stdout/stderr, which
 * Vercel's log drain indexes by field. No vendor SDK. Everything passes through
 * the scrubber, so call sites can pass raw error objects without leaking PII.
 */
import { requestIdOf } from "./request-id";
import { scrubFields, scrubStack, scrubText } from "./scrub";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

export function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: scrubText(err.message), stack: scrubStack(err.stack) };
  }
  return { name: "NonError", message: scrubText(typeof err === "string" ? err : JSON.stringify(err) ?? "") };
}

function emit(level: Level, msg: string, base: Fields, fields: Fields): void {
  const { err, ...rest } = fields;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: scrubText(msg, 200),
    ...base,
    ...scrubFields(rest),
    ...(err === undefined ? {} : { err: serializeError(err) }),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

/** Logger bound to a route and (when present) the request id middleware stamped on the request. */
export function getLogger(route: string, req?: { headers: Headers }): Logger {
  const base: Fields = { route };
  const id = req ? requestIdOf(req) : undefined;
  if (id) base.request_id = id;
  return {
    debug: (m, f = {}) => emit("debug", m, base, f),
    info: (m, f = {}) => emit("info", m, base, f),
    warn: (m, f = {}) => emit("warn", m, base, f),
    error: (m, f = {}) => emit("error", m, base, f),
  };
}
