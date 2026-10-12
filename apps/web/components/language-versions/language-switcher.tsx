import Link from "next/link";

import type { VersionSibling } from "@/lib/song/language-version";
import { prettyLanguage } from "@/lib/song/labels";

/**
 * Switch between sibling language versions of a song. Server component:
 * plain links. Renders nothing when a song has no siblings.
 */
export function LanguageSwitcher({
  currentId,
  siblings,
}: {
  currentId: string;
  siblings: VersionSibling[];
}) {
  if (siblings.length < 2) return null;
  return (
    <nav aria-label="Language versions" className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-foreground/50">Also in</span>
      {siblings.map((s) => {
        const current = s.id === currentId;
        const href = s.owned ? `/songs/${s.id}` : s.publicId ? `/s/${s.publicId}` : null;
        const label = prettyLanguage(s.language);
        const cls = `inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${
          current ? "border-accent bg-accent/10 text-accent" : "border-muted/50 hover:border-accent"
        }`;
        if (current || !href) {
          return (
            <span key={s.id} aria-current={current ? "page" : undefined} className={cls}>
              {label}
              {!current && s.status !== "completed" ? " · in progress" : ""}
            </span>
          );
        }
        return (
          <Link key={s.id} href={href} lang={s.language} className={cls}>
            {label}
            {s.status !== "completed" ? " · in progress" : ""}
          </Link>
        );
      })}
    </nav>
  );
}
