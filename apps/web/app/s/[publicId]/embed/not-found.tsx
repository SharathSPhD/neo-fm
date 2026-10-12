/**
 * Shown inside the iframe when the song is unknown, private or has been
 * taken down. One message for all three so the embed cannot be used to
 * tell which ids exist.
 */
export default function EmbedNotFound() {
  return (
    <main className="embed-root flex min-h-screen flex-col items-center justify-center gap-2 px-4 py-6 text-center" data-embed-theme="auto">
      <p className="text-sm font-medium">This song isn&apos;t available.</p>
      <p className="text-xs text-foreground/60">It may be private or no longer shared.</p>
      {/* Plain anchor on purpose: target=_top must leave the embedding iframe. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        target="_top"
        rel="noopener"
        className="text-[11px] uppercase tracking-widest text-foreground/60 hover:text-foreground"
      >
        Made with neo-fm ↗
      </a>
    </main>
  );
}
