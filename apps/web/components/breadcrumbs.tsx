/**
 * Breadcrumbs primitive. Pages render `<Breadcrumbs>` directly when they
 * have meaningful depth (`Library > "Sundown drive"`, `Account > Privacy`).
 */
import Link from "next/link";

export type Crumb = {
  href?: string;
  label: string;
};

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-foreground/60">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="rounded hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "text-foreground" : ""}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden className="text-foreground/30">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
