import { describe, expect, it } from "vitest";

import { scrubFields, scrubStack, scrubText, scrubUrl } from "../../lib/obs/scrub";

describe("scrubText", () => {
  it.each([
    ["mail me at jane.doe+x@example.co.uk now", "<email>"],
    // Assembled at runtime so no JWT-shaped literal sits in the repo for secret scanners to flag.
    [`auth ${["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ0ZXN0In0", "abcdEFGH1234"].join(".")} failed`, "<jwt>"],
    ["Authorization: Bearer abcdef1234567890xyz", "<redacted>"],
    ["user 3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab missing", "<uuid>"],
    ["from 203.0.113.42 refused", "<ip>"],
    ["call +91 98765 43210 please", "<phone>"],
    ["key AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 leaked", "<token>"],
    ["password=hunter2 rejected", "password=<redacted>"],
  ])("redacts %s", (input, marker) => {
    const out = scrubText(input);
    expect(out).toContain(marker);
  });

  it("never leaves a bearer token behind", () => {
    expect(scrubText("Authorization: Bearer abcdef1234567890xyz")).not.toContain("abcdef1234567890xyz");
  });

  it("never leaves the original secrets behind", () => {
    const out = scrubText("jane@example.com 203.0.113.42 3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab hunter2");
    expect(out).not.toMatch(/jane@|203\.0\.113|3f2b8c1e/);
  });

  it("truncates and tolerates non-strings", () => {
    expect(scrubText("a".repeat(600), 100).length).toBeLessThanOrEqual(101);
    expect(scrubText(undefined)).toBe("");
  });
});

describe("scrubUrl", () => {
  it("keeps the path only", () => {
    expect(scrubUrl("https://neo-fm.app/songs/new?token=abc&q=my%20secret#frag")).toBe("/songs/new");
  });
  it("masks id-like path segments", () => {
    expect(scrubUrl("/s/smkpb23456")).toBe("/s/:id");
    expect(scrubUrl("/native-review/abcDEF123456789/ratings")).toBe("/native-review/:id/ratings");
  });
  it("handles junk", () => {
    expect(scrubUrl(undefined)).toBe("");
    expect(scrubUrl("")).toBe("");
  });
});

describe("scrubStack", () => {
  it("drops origins and query strings and caps frames", () => {
    const frames = Array.from({ length: 30 }, (_, i) => `    at f${i} (https://neo-fm.app/_next/static/chunks/app.js?v=abc123:1:${i})`);
    const out = scrubStack(["TypeError: boom", ...frames].join("\n"));
    expect(out.split("\n").length).toBeLessThanOrEqual(13);
    expect(out).not.toContain("https://");
    expect(out).not.toContain("v=abc123");
  });
});

describe("scrubFields", () => {
  it("redacts sensitive keys, scrubs strings, recurses one level", () => {
    const out = scrubFields({ email: "a@b.co", prompt: "my private lyrics", detail: "x a@b.co y", nested: { token: "t", ok: 1 }, n: 3 });
    expect(out).toEqual({ email: "<redacted>", prompt: "<redacted>", detail: "x <email> y", nested: { token: "<redacted>", ok: 1 }, n: 3 });
  });
});
