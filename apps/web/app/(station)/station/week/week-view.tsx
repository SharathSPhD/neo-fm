"use client";

import { useState } from "react";
import Link from "next/link";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { UI_LANG_ENDONYM, UI_LANGS, isUiLang } from "@/lib/i18n/ui-strings";
import { moodLabel } from "@/lib/recap/moods";
import { prettyLanguage } from "@/lib/song/labels";
import type { Week } from "@/lib/station/week";
import { WEEK_STRINGS } from "@/lib/station/week-strings";

export function WeekView({ week }: { week: Week | null }) {
  const { lang, setLang } = useUiLang();
  const S = WEEK_STRINGS[lang];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/station/week/image?lang=${lang}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], "neo-fm-week.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: S.title });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setMsg("Couldn't prepare the image. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const name = (c: string) => (isUiLang(c) ? UI_LANG_ENDONYM[c] : prettyLanguage(c));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-medium tracking-tight">{S.title}</h1>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Language">
        {UI_LANGS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={l === lang}
            className={`rounded-full border px-3 py-1 text-sm ${l === lang ? "border-accent text-accent" : "border-muted/40 text-foreground/70"}`}
          >
            {UI_LANG_ENDONYM[l]}
          </button>
        ))}
      </div>

      {!week || week.empty ? (
        <div className="flex flex-col gap-3 rounded-md border border-muted/20 bg-muted/5 px-5 py-6">
          <p>{S.empty}</p>
          <Link href="/station" className="text-accent underline-offset-4 hover:underline">{S.listen} →</Link>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {[
              [week.minutes, S.minutes],
              [week.streak, S.streak],
              [week.activeDays, S.days],
            ].map(([n, label]) => (
              <div key={String(label)} className="rounded-md border border-muted/20 bg-muted/5 px-4 py-3">
                <dd className="text-3xl font-semibold text-accent">{Number(n).toLocaleString("en-IN")}</dd>
                <dt className="text-xs text-foreground/60">{label}</dt>
              </div>
            ))}
          </dl>

          {week.favourite ? (
            <section className="rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
              <h2 className="text-xs uppercase tracking-wider text-foreground/60">{S.favourite}</h2>
              <p className="text-xl font-medium">{week.favourite.title ?? "—"}</p>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-wider text-foreground/60">{S.languages}</h2>
            <ul className="flex flex-wrap gap-2">
              {week.languages.slice(0, 5).map((l) => (
                <li key={l.language} className="rounded-full border border-accent/40 px-3 py-1 text-sm">{name(l.language)}</li>
              ))}
            </ul>
          </section>

          {week.moods.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs uppercase tracking-wider text-foreground/60">{S.moods}</h2>
              <ul className="flex flex-wrap gap-2">
                {week.moods.slice(0, 4).map((m) => (
                  <li key={m.mood} className="rounded-full border border-accent/40 px-3 py-1 text-sm">{moodLabel(m.mood, lang)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <button
            type="button"
            onClick={share}
            disabled={busy}
            className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
          >
            {S.share}
          </button>
          {msg ? <p role="status" className="text-sm text-foreground/70">{msg}</p> : null}
        </>
      )}
    </div>
  );
}
