import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import { PUBLIC_PATHS, siteUrl } from "@/lib/seo/site";

describe("seo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("siteUrl prefers NEXT_PUBLIC_APP_URL and strips trailing slashes", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://neo-fm.example/");
    expect(siteUrl()).toBe("https://neo-fm.example");
  });

  it("robots keeps app, api and admin surfaces out and points at the sitemap", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://neo-fm.example");
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/admin/", "/library", "/songs/"]));
    expect(rule.allow).toContain("/s/");
    expect(r.sitemap).toBe("https://neo-fm.example/sitemap.xml");
  });

  it("public paths are unique and absolute", () => {
    const paths = PUBLIC_PATHS.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((p) => p.startsWith("/"))).toBe(true);
  });
});
