import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import sitemap from "@/app/sitemap";
import { isoDuration, jsonLdString, musicPlaylistLd, musicRecordingLd } from "@/lib/seo/jsonld";
import { LANGUAGE_PAGES, hreflangPaths, languagePageBySlug, languagePagePath } from "@/lib/seo/language-pages";
import { rankSongs } from "@/lib/seo/top-songs";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "order", "limit", "in", "returns"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
    return { from: () => q };
  },
}));

describe("json-ld", () => {
  it("formats durations", () => {
    expect(isoDuration(192)).toBe("PT3M12S");
    expect(isoDuration(60)).toBe("PT1M");
    expect(isoDuration(45)).toBe("PT45S");
    expect(isoDuration(0)).toBeUndefined();
    expect(isoDuration(null)).toBeUndefined();
  });
  it("cannot be closed early by song text", () => {
    const s = jsonLdString({ name: "</script><script>alert(1)</script> " });
    expect(s).not.toContain("</script>");
    expect(s).not.toContain(" ");
    expect(JSON.parse(s).name).toContain("</script>");
  });
  it("builds a MusicRecording that points at the embed, not a signed URL", () => {
    const ld = musicRecordingLd({
      base: "https://x.test",
      publicId: "abcdefghjk",
      name: "மழை",
      language: "ta",
      genre: "Carnatic",
      durationSeconds: 192,
      datePublished: "2026-10-10T10:00:00Z",
      lyrics: "வரி ஒன்று\nவரி இரண்டு",
      hasAudio: true,
    });
    expect(ld["@type"]).toBe("MusicRecording");
    expect(ld.url).toBe("https://x.test/s/abcdefghjk");
    expect(ld.duration).toBe("PT3M12S");
    expect(ld.audio).toMatchObject({ embedUrl: "https://x.test/s/abcdefghjk/embed" });
    expect(JSON.stringify(ld)).not.toMatch(/token=|signed/i);
    expect(ld.recordingOf?.lyrics.text).toContain("வரி ஒன்று");
  });
  it("omits audio and lyrics when absent, and caps long lyrics", () => {
    const bare = musicRecordingLd({ base: "https://x.test", publicId: "abcdefghjk", name: "n", language: "hi" });
    expect(bare).not.toHaveProperty("audio");
    expect(bare).not.toHaveProperty("recordingOf");
    const long = musicRecordingLd({ base: "", publicId: "abcdefghjk", name: "n", language: "hi", lyrics: "क".repeat(9000) });
    expect(long.recordingOf?.lyrics.text.length).toBe(5000);
  });
  it("builds a MusicPlaylist with positions", () => {
    const ld = musicPlaylistLd({
      base: "https://x.test",
      path: "/discover",
      name: "N",
      tracks: [
        { publicId: "aaaaaaaaaa", name: "A", language: "hi" },
        { publicId: "bbbbbbbbbb", name: "B", language: "ta" },
      ],
    });
    expect(ld).toMatchObject({ "@type": "MusicPlaylist", numTracks: 2, url: "https://x.test/discover" });
    expect(ld.track.map((t) => t.position)).toEqual([1, 2]);
    expect(ld.track[1]!.url).toBe("https://x.test/s/bbbbbbbbbb");
  });
});

describe("language pages", () => {
  it("covers the launch languages with unique slugs and complete copy", () => {
    expect(LANGUAGE_PAGES.map((p) => p.code).sort()).toEqual(["bn", "hi", "kn", "mr", "ta", "te"]);
    expect(new Set(LANGUAGE_PAGES.map((p) => p.slug)).size).toBe(6);
    for (const p of LANGUAGE_PAGES) {
      expect(p.title).toContain("neo-fm");
      expect(p.points.length).toBeGreaterThanOrEqual(3);
      for (const field of [p.h1, p.intro, p.cta, p.listen, p.browse, p.songsHeading, p.empty, p.play]) expect(field.length).toBeGreaterThan(3);
      // Copy is in the page's own script, not the English template.
      expect(p.h1).not.toMatch(/[A-Za-z]{4,}/);
    }
  });
  it("resolves slugs and rejects unknown ones", () => {
    expect(languagePageBySlug("tamil")?.code).toBe("ta");
    expect(languagePageBySlug("klingon")).toBeUndefined();
    expect(languagePagePath(languagePageBySlug("hindi")!)).toBe("/ai-songs/hindi");
  });
  it("hreflang cluster includes en, x-default and every language", () => {
    const m = hreflangPaths();
    expect(m.en).toBe("/");
    expect(m["x-default"]).toBe("/");
    expect(Object.keys(m).sort()).toEqual(["bn", "en", "hi", "kn", "mr", "ta", "te", "x-default"]);
  });
});

describe("rankSongs", () => {
  it("sorts by likes and keeps recency order for ties", () => {
    const rows = [
      { id: "new", likes: 0 },
      { id: "liked", likes: 3 },
      { id: "older", likes: 0 },
    ];
    expect(rankSongs(rows, 2).map((r) => r.id)).toEqual(["liked", "new"]);
  });
});

describe("sitemap", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("lists language pages with the full hreflang cluster, and the landing page as English", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://neo.test");
    const entries = await sitemap();
    const tamil = entries.find((e) => e.url === "https://neo.test/ai-songs/tamil");
    expect(tamil?.alternates?.languages).toMatchObject({
      en: "https://neo.test",
      ta: "https://neo.test/ai-songs/tamil",
      hi: "https://neo.test/ai-songs/hindi",
      "x-default": "https://neo.test",
    });
    const home = entries.find((e) => e.url === "https://neo.test");
    expect(home?.alternates?.languages?.kn).toBe("https://neo.test/ai-songs/kannada");
    expect(entries.filter((e) => /\/ai-songs\/[a-z]+$/.test(e.url))).toHaveLength(6);
  });
});

// next/dist's isNotFoundError moved between 14.2.x and 15; the digest is the stable contract.
const isNotFoundError = (e: unknown): boolean => {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return digest === "NEXT_NOT_FOUND" || digest === "NEXT_HTTP_ERROR_FALLBACK;404";
};

import { LANGUAGE_ARTICLES, articlePath } from "@/lib/seo/language-articles";
import { articleLd } from "@/lib/seo/jsonld";

describe("unknown language slugs", () => {
  it("404 from the page, its metadata and the article (no soft 404)", async () => {
    const lang = await import("@/app/ai-songs/[lang]/page");
    const how = await import("@/app/ai-songs/[lang]/how-it-works/page");
    const params = Promise.resolve({ lang: "klingon" });
    await expect(lang.generateMetadata({ params })).rejects.toSatisfy(isNotFoundError);
    await expect(lang.default({ params })).rejects.toSatisfy(isNotFoundError);
    await expect(how.generateMetadata({ params })).rejects.toSatisfy(isNotFoundError);
    await expect(how.default({ params })).rejects.toSatisfy(isNotFoundError);
    expect(lang.dynamicParams).toBe(false);
    expect(how.dynamicParams).toBe(false);
    expect(lang.generateStaticParams().map((p) => p.lang).sort()).toEqual(["bengali", "hindi", "kannada", "marathi", "tamil", "telugu"]);
  });
  it("lives outside the (marketing) group, whose loading boundary commits a 200 before notFound() runs", () => {
    expect(existsSync(join(process.cwd(), "app/ai-songs/[lang]/page.tsx"))).toBe(true);
    expect(existsSync(join(process.cwd(), "app/(marketing)/ai-songs"))).toBe(false);
  });
});

describe("explainer articles", () => {
  it("exist for every language page, in its own script, and say the audio is AI-generated", () => {
    for (const p of LANGUAGE_PAGES) {
      const a = LANGUAGE_ARTICLES[p.code];
      expect(a.sections).toHaveLength(5);
      expect(a.h1).toMatch(/neo-fm/);
      expect(a.sections.map((s) => s.heading + s.body).join(" ")).toMatch(/Lyria/);
      expect(a.honest).toMatch(/AI/);
      expect(articlePath(p)).toBe(`/ai-songs/${p.slug}/how-it-works`);
    }
  });
  it("builds Article JSON-LD without invented dates", () => {
    const ld = articleLd({ base: "https://x.test", path: "/ai-songs/tamil/how-it-works", headline: "h", description: "d", language: "ta", sections: ["a", "b"] });
    expect(ld["@type"]).toBe("Article");
    expect(ld).not.toHaveProperty("datePublished");
    expect(ld.articleSection).toEqual(["a", "b"]);
  });
  it("are in the sitemap", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://neo.test");
    const urls = (await sitemap()).map((e) => e.url);
    for (const p of LANGUAGE_PAGES) expect(urls).toContain(`https://neo.test${articlePath(p)}`);
    vi.unstubAllEnvs();
  });
});

describe("language OG image", () => {
  it("renders a PNG for each language and a generic card for unknown slugs", async () => {
    const og = await import("@/app/ai-songs/[lang]/opengraph-image");
    for (const slug of [...LANGUAGE_PAGES.map((p) => p.slug), "klingon"]) {
      const res = await og.default({ params: Promise.resolve({ lang: slug }) });
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.length).toBeGreaterThan(5_000);
    }
  }, 30_000);
});
