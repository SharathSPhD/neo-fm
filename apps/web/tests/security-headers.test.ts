import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { applySecurityHeaders, isEmbedPath, supabaseHost } from "../lib/security-headers";

const apply = (pathname: string, host: string | null = "abc.supabase.co") => applySecurityHeaders(NextResponse.next(), { pathname, supabaseHost: host });

describe("security headers", () => {
  it("locks down ordinary pages against framing", () => {
    const h = apply("/library").headers;
    expect(h.get("X-Frame-Options")).toBeNull();
    const csp = h.get("Content-Security-Policy")!;
    expect(csp).toContain("frame-ancestors 'self' https://web.telegram.org https://webk.telegram.org https://webz.telegram.org");
    expect(csp).not.toMatch(/frame-ancestors[^;]*\*/);
    expect(h.get("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Permissions-Policy")).toContain("camera=()");
  });
  it("lets the real embed route (/s/<id>/embed) be framed by any site", () => {
    const h = apply("/s/abc123/embed").headers;
    expect(h.get("X-Frame-Options")).toBeNull();
    expect(h.get("Content-Security-Policy")).toContain("frame-ancestors *");
  });
  it("only relaxes framing for embed paths, not for lookalikes", () => {
    expect(isEmbedPath("/embed/x")).toBe(true);
    expect(isEmbedPath("/s/abc/embed")).toBe(true);
    expect(isEmbedPath("/s/abc/embed/")).toBe(true);
    for (const p of ["/s/abc", "/s/abc/embedded", "/s/a/b/embed", "/embedded", "/api/embed", "/account"]) expect(isEmbedPath(p)).toBe(false);
  });
  it("allows the Supabase host in connect-src only when configured", () => {
    expect(apply("/", "abc.supabase.co").headers.get("Content-Security-Policy")).toContain("https://abc.supabase.co wss://abc.supabase.co");
    expect(apply("/", null).headers.get("Content-Security-Policy")).not.toContain("supabase.co");
  });
  it("never allows object embeds or foreign form targets", () => {
    const csp = apply("/").headers.get("Content-Security-Policy")!;
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });
  it("derives the supabase host from env and tolerates garbage", () => {
    const old = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
      expect(supabaseHost()).toBe("abc.supabase.co");
      process.env.NEXT_PUBLIC_SUPABASE_URL = "not a url";
      expect(supabaseHost()).toBeNull();
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      expect(supabaseHost()).toBeNull();
    } finally {
      if (old === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = old;
    }
  });
});

describe("report-only strict CSP", () => {
  const withNonce = (pathname: string) => applySecurityHeaders(NextResponse.next(), { pathname, supabaseHost: "abc.supabase.co", nonce: "n0nce" }).headers;
  it("ships a nonce + strict-dynamic policy without unsafe-inline/eval scripts, next to the enforced one", () => {
    const h = withNonce("/library");
    const ro = h.get("Content-Security-Policy-Report-Only")!;
    expect(ro).toContain("script-src 'self' 'nonce-n0nce' 'strict-dynamic'");
    expect(ro).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(ro).toContain("frame-ancestors 'self' https://web.telegram.org");
    expect(ro).toContain("report-uri /api/csp-report");
    expect(h.get("Reporting-Endpoints")).toBe('csp-endpoint="/api/csp-report"');
    expect(h.get("Content-Security-Policy")).toContain("'unsafe-inline'");
  });
  it("carries the nonce in the enforced header's first script-src* directive so Next can stamp its scripts", async () => {
    const h = withNonce("/library");
    const first = h.get("Content-Security-Policy")!.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"))!;
    expect(first).toBe("script-src-attr 'nonce-n0nce'");
    const { getScriptNonceFromHeader } = await import("next/dist/server/app-render/get-script-nonce-from-header");
    expect(getScriptNonceFromHeader(h.get("Content-Security-Policy")!)).toBe("n0nce");
    expect(getScriptNonceFromHeader(h.get("Content-Security-Policy-Report-Only")!)).toBe("n0nce");
  });
  it("keeps the embed route framable in the report-only policy too", () => {
    expect(withNonce("/s/abc123/embed").get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors *");
  });
  it("omits the report-only header when no nonce is supplied, and nonces differ per call", async () => {
    expect(apply("/").headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    const { newNonce } = await import("../lib/security-headers");
    expect(newNonce()).not.toBe(newNonce());
  });
});
