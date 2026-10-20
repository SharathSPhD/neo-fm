import Link from "next/link";

/** neo-fm wordmark with a live "on air" dot. */
export function BrandMark({ label = "neo-fm home" }: { label?: string }) {
  return (
    <Link
      href="/"
      aria-label={label}
      className="inline-flex min-h-8 flex-none items-center gap-2 whitespace-nowrap rounded-sm text-lg font-semibold tracking-tight focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="live-dot" aria-hidden />
      <span>
        neo<span className="text-accent">-fm</span>
      </span>
    </Link>
  );
}
