/**
 * Empty-state primitive: icon + headline + body + optional CTA.
 *
 * Used by `/library` (no songs), `/discover` (filter returned nothing),
 * `/u/[handle]` (profile with no published songs), etc.
 */
import Link from "next/link";

export function EmptyState({
  title,
  body,
  cta,
  icon,
}: {
  title: string;
  body?: string;
  cta?: { href: string; label: string };
  icon?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-muted/40 bg-muted/10 p-8 text-center">
      <div
        aria-hidden
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/30 text-2xl"
      >
        {icon ?? "♪"}
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {body && (
        <p className="text-sm leading-relaxed text-foreground/70">{body}</p>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="mt-2 inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
