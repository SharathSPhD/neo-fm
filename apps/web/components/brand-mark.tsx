import Link from "next/link";

/** neo-fm wordmark with a live "on air" dot. */
export function BrandMark({ label = "neo-fm home" }: { label?: string }) {
  return (
    <Link
      href="/"
      aria-label={label}
      className="inline-flex flex-none items-center gap-2 whitespace-nowrap rounded text-lg font-semibold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="live-dot" aria-hidden />
      <span>
        neo<span className="text-accent">-fm</span>
      </span>
    </Link>
  );
}
