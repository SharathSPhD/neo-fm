"use client";

import { useEffect } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { chrome, LATEST_ID, pick, WHATS_NEW } from "@/lib/whats-new/entries";
import { markSeen } from "@/lib/whats-new/seen";

export function WhatsNewList() {
  const { lang } = useUiLang();
  useEffect(() => markSeen(LATEST_ID), []);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{chrome("title", lang)}</h1>
      <p className="mt-1 text-sm text-foreground/60">{chrome("intro", lang)}</p>
      <ol className="mt-6 space-y-4">
        {WHATS_NEW.map((e) => (
          <li key={e.id} className="rounded-lg border border-muted/30 p-4">
            <time dateTime={e.date} className="text-xs text-foreground/50">{e.date}</time>
            <h2 className="mt-1 text-base font-medium">{pick(e.title, lang)}</h2>
            <p className="mt-1 text-sm text-foreground/70">{pick(e.body, lang)}</p>
          </li>
        ))}
      </ol>
    </>
  );
}
