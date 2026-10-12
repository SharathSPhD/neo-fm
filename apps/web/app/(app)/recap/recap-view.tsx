"use client";

import { useState } from "react";
import Link from "next/link";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { UI_LANG_ENDONYM, UI_LANGS, isUiLang } from "@/lib/i18n/ui-strings";
import type { Recap } from "@/lib/recap/compute";
import { RECAP_STRINGS, monthLabel } from "@/lib/recap/strings";
import { prettyLanguage } from "@/lib/song/labels";

export function RecapView({ recap, month }: { recap: Recap; month: string }) {
  const { lang, setLang } = useUiLang();
  const S = RECAP_STRINGS[lang];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const imgUrl = `/api/recap/image?month=${month}&lang=${lang}`;

  async function share() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(imgUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `neo-fm-${month}-recap.png`, { type: "image/png" });
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
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-medium tracking-tight">{S.title}</h1>
        <p className="text-sm text-foreground/60">{monthLabel(month, lang)}</p>
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

      {recap.songs === 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-muted/20 bg-muted/5 px-5 py-6">
          <p>{S.empty}</p>
          <Link href="/songs/new" className="text-accent underline-offset-4 hover:underline">Make a song →</Link>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {[
              [recap.songs, S.songs],
              [recap.likes, S.likes],
              [recap.listens, S.listens],
            ].map(([n, label]) => (
              <div key={String(label)} className="rounded-md border border-muted/20 bg-muted/5 px-4 py-3">
                <dd className="text-3xl font-semibold text-accent">{Number(n).toLocaleString("en-IN")}</dd>
                <dt className="text-xs text-foreground/60">{label}</dt>
              </div>
            ))}
          </dl>

          {recap.topSong ? (
            <section className="rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
              <h2 className="text-xs uppercase tracking-wider text-foreground/60">{S.topSong}</h2>
              <Link href={`/songs/${recap.topSong.id}`} className="text-xl font-medium underline-offset-4 hover:underline">
                {recap.topSong.title}
              </Link>
              <p className="text-sm text-foreground/60">♥ {recap.topSong.likes} · ▶ {recap.topSong.listens}</p>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-wider text-foreground/60">{S.languages}</h2>
            <ul className="flex flex-wrap gap-2">
              {recap.languages.map((l) => (
                <li key={l.code} className="rounded-full border border-muted/40 px-3 py-1 text-sm">{name(l.code)} · {l.count}</li>
              ))}
            </ul>
          </section>

          {recap.moods.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs uppercase tracking-wider text-foreground/60">{S.moods}</h2>
              <ul className="flex flex-wrap gap-2">
                {recap.moods.map((m) => (
                  <li key={m.mood} className="rounded-full border border-muted/40 px-3 py-1 text-sm">{m.mood} · {m.count}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {recap.collections.created + recap.collections.added > 0 ? (
            <p className="text-sm text-foreground/70">
              {S.collections}: {recap.collections.created} · +{recap.collections.added}
            </p>
          ) : null}
        </>
      )}

      <section className="flex flex-col items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imgUrl} alt={S.title} width={270} height={480} className="rounded-xl border border-muted/20" loading="lazy" />
        <div className="flex items-center gap-3">
          <button type="button" onClick={share} disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-60">
            {busy ? "…" : "Share story image"}
          </button>
          <a href={`${imgUrl}&download=1`} className="text-sm text-accent underline-offset-4 hover:underline">Download</a>
        </div>
        <p className="text-xs text-foreground/50">The image is private to you until you share it. It never includes other people&apos;s names.</p>
        {msg ? <p role="alert" className="text-sm text-red-500">{msg}</p> : null}
      </section>
    </div>
  );
}
