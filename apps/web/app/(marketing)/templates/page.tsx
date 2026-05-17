/**
 * /templates -- public, read-only browse of the curated Song Document
 * templates. Mirrors the in-app PresetGallery (apps/web/app/(app)/
 * songs/new/preset-gallery.tsx) but lives on the marketing surface so
 * logged-out visitors can see what they'd be picking from.
 *
 * Each card links to `/sign-in?next=/songs/new?preset=<id>` so the
 * sign-in flow lands the user on the creation canvas with the preset
 * already applied. We deliberately avoid `/songs/new` from public
 * surfaces because that route bounces anonymous users to /sign-in
 * with no preset hint, which v1.4 manual testing surfaced as the
 * "Open template gallery" landing bug.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { PRESETS, type StylePreset } from "@neo-fm/style-presets";

// The shared MarketingLayout reads the auth session per-request
// (createServerClient -> supabase.auth.getUser), so this page can't
// be statically pre-rendered. force-static would trip the env-var
// guard during `next build`. Use force-dynamic to match /discover.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Templates · neo-fm",
  description:
    "Browse curated Song Document templates -- Indian classical, Indian folk, and crossover starters with raga, tala, and instrumentation already chosen.",
};

// Shared with the in-app gallery; duplicated here so the marketing
// surface doesn't pull a "use client" boundary into a static page.
const STYLE_TONE: Record<string, string> = {
  carnatic:
    "from-amber-500/15 via-amber-500/5 to-transparent border-amber-500/30",
  hindustani:
    "from-indigo-500/15 via-indigo-500/5 to-transparent border-indigo-500/30",
  "kannada-folk":
    "from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/30",
  "kannada-light-classical":
    "from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/30",
  "tamil-folk":
    "from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/30",
  "telugu-keerthana":
    "from-amber-500/15 via-amber-500/5 to-transparent border-amber-500/30",
  "sanskrit-shloka":
    "from-amber-500/15 via-amber-500/5 to-transparent border-amber-500/30",
  "bengali-rabindrasangeet":
    "from-indigo-500/15 via-indigo-500/5 to-transparent border-indigo-500/30",
  "bollywood-ballad":
    "from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/25",
  western: "from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/25",
};

export default function TemplatesPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          Templates
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Curated Song Document templates
        </h1>
        <p className="max-w-2xl text-base text-foreground/70">
          Indian classical, Indian folk, and crossover starters with raga,
          tala, instrumentation and a starter verse already chosen. Pick one
          to seed the creation canvas -- you can rewrite the lyrics, change
          the language, swap the raga, or regenerate any section.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((preset) => (
          <li key={preset.id}>
            <TemplateCard preset={preset} />
          </li>
        ))}
      </ul>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-muted/30 pt-6 text-sm text-foreground/60">
        <p>
          Already have an account?{" "}
          <Link
            href="/sign-in?next=/songs/new"
            className="text-accent hover:underline"
          >
            Sign in to start creating &rarr;
          </Link>
        </p>
        <Link
          href="/discover"
          className="text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent rounded"
        >
          Listen to songs others have made &rarr;
        </Link>
      </footer>
    </main>
  );
}

function TemplateCard({ preset }: { preset: StylePreset }) {
  const family = preset.song_document.style_family;
  const tone = STYLE_TONE[family] ?? STYLE_TONE.western;
  const href = `/sign-in?next=${encodeURIComponent(`/songs/new?preset=${preset.id}`)}`;
  return (
    <Link
      href={href}
      data-preset={preset.id}
      className={[
        "flex h-full w-full flex-col gap-2 rounded-md border bg-gradient-to-b px-4 py-3 text-left transition hover:border-foreground/40 hover:bg-muted/20 focus:outline-none focus:ring-2 focus:ring-accent",
        tone,
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">
          {preset.title}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-foreground/40">
          {family}
        </span>
      </div>
      <span className="text-xs text-foreground/65">{preset.subtitle}</span>
      <p className="text-xs leading-snug text-foreground/55">
        {preset.description}
      </p>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {preset.chips.map((c) => (
          <span
            key={c}
            className="rounded-full border border-foreground/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground/55"
          >
            {c}
          </span>
        ))}
      </div>
    </Link>
  );
}
