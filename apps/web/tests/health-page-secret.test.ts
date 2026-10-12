import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The pasted ops secret may live in sessionStorage and Authorization headers only. This is a source-level guard:
// the page is a client component, so a rendered test would need a DOM environment this suite does not use.
const src = readFileSync(join(__dirname, "../app/admin/health/page.tsx"), "utf8");

describe("admin health page secret handling", () => {
  it("never touches localStorage or cookies", () => {
    expect(src).not.toMatch(/localStorage|document\.cookie|indexedDB/);
  });
  it("only stores the secret in sessionStorage", () => {
    const writes = [...src.matchAll(/(\w+Storage)\.setItem\(/g)].map((m) => m[1]);
    expect(writes).toEqual(["sessionStorage"]);
  });
  it("sends the secret only in an Authorization header, never in a URL", () => {
    const urls = [...src.matchAll(/fetch\(\s*`([^`]*)`/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).not.toMatch(/secret|\$\{s\}|\$\{secret\}/i);
    expect(src).toMatch(/authorization: `Bearer \$\{s\}`/);
    expect(src).not.toMatch(/router\.(push|replace)|location\.(href|search|hash)|searchParams/);
  });
});
