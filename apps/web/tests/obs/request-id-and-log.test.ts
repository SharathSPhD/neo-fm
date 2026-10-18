import { afterEach, describe, expect, it, vi } from "vitest";

import { getLogger, serializeError } from "../../lib/obs/log";
import { REQUEST_ID_HEADER, requestIdOf, resolveRequestId } from "../../lib/obs/request-id";

describe("resolveRequestId", () => {
  it("reuses a well-formed incoming id", () => {
    const h = new Headers({ [REQUEST_ID_HEADER]: "abc-123_DEF.456" });
    expect(resolveRequestId(h)).toBe("abc-123_DEF.456");
  });
  it.each(["short", "has spaces in it!!", "x".repeat(65), "<script>alert(1)</script>"])("mints a fresh id instead of trusting %s", (bad) => {
    const id = resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: bad }));
    expect(id).not.toBe(bad);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("requestIdOf ignores malformed ids", () => {
    expect(requestIdOf({ headers: new Headers({ [REQUEST_ID_HEADER]: "no good" }) })).toBeUndefined();
    expect(requestIdOf({ headers: new Headers({ [REQUEST_ID_HEADER]: "goodid-1234" }) })).toBe("goodid-1234");
  });
});

describe("getLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits one JSON line with route and request id, scrubbed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = getLogger("/api/x", { headers: new Headers({ [REQUEST_ID_HEADER]: "req-abcdef12" }) });
    log.error("boom for a@b.co", { detail: "token=abcd1234", email: "a@b.co", err: new Error("bad thing for c@d.org") });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(spy.mock.calls[0]![0]));
    expect(line).toMatchObject({ level: "error", route: "/api/x", request_id: "req-abcdef12", email: "<redacted>" });
    expect(line.msg).toBe("boom for <email>");
    expect(line.detail).toBe("token=<redacted>");
    expect(line.err.message).toBe("bad thing for <email>");
    expect(JSON.stringify(line)).not.toMatch(/a@b\.co|c@d\.org/);
  });

  it("routes levels to the right console method", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = getLogger("/api/y");
    log.warn("w");
    log.info("i");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]![0]))).not.toHaveProperty("request_id");
  });

  it("serializes non-Error throwables", () => {
    expect(serializeError("plain string").name).toBe("NonError");
  });
});
