"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { chrome, LATEST_ID } from "@/lib/whats-new/entries";
import { readSeen, subscribeSeen } from "@/lib/whats-new/seen";

/** Nav link with a "new" dot until the visitor has opened the page for the latest entry. */
export function WhatsNewLink({ className, activeClassName }: { className: string; activeClassName?: string }) {
  const active = (usePathname() ?? "").startsWith("/whats-new");
  const { lang } = useUiLang();
  // Server snapshot says "seen" so the badge never flashes on hydration.
  const seen = useSyncExternalStore(subscribeSeen, () => readSeen() === LATEST_ID, () => true);
  const label = chrome("title", lang);
  return (
    <Link href="/whats-new" aria-current={active ? "page" : undefined} className={active && activeClassName ? `${className} ${activeClassName}` : className}>
      {label}
      {!seen ? (
        <span className="ml-1.5 inline-block rounded-full bg-accent px-1.5 text-[10px] font-medium text-background">
          {chrome("badge", lang)}
        </span>
      ) : null}
    </Link>
  );
}
