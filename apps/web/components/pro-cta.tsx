import Link from "next/link";

/**
 * Upgrade nudge shown wherever a visitor has just heard a free 30-second clip.
 * Copy only claims what the Pro plan actually does (multi-pass lyric writing, full-length render).
 */
export function ProCta({ compact = false }: { compact?: boolean }) {
  return (
    <aside
      aria-label="Upgrade to Pro"
      className={`rounded-xl border border-accent/40 bg-accent/5 ${compact ? "px-4 py-3" : "p-6"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <p className={`${compact ? "text-sm" : "text-base"} font-medium`}>
            Loved the clip? Make the whole song yours.
          </p>
          <p className="mt-1 text-sm text-foreground/70">
            Free songs are 30-second previews. Pro writes your lyrics in several passes, lets you steer
            them, and renders a full-length track in your language and style.
          </p>
        </div>
        <Link
          href="/pricing"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          See Pro
        </Link>
      </div>
    </aside>
  );
}
