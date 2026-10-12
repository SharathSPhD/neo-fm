/**
 * /native-review/[token] -- native-speaker review kit. Private link, no sign-in, no personal data collected.
 * Shows the fixed set of songs for the token's language with a short rating form per song.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LANGUAGE_NAMES } from "@/lib/native-review/kit";
import { loadSongs, resolveToken } from "@/lib/native-review/load";

import { RatingForm } from "./rating-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review songs -- neo-fm", robots: { index: false, follow: false } };

export default async function ReviewPage({ params }: { params: { token: string } }) {
  const reviewer = await resolveToken(params.token);
  if (!reviewer) notFound();
  const songs = await loadSongs(reviewer);
  const language = LANGUAGE_NAMES[reviewer.language];
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{language} song review</h1>
      <p className="mt-3 text-foreground/70">
        Thank you for helping us check how natural our {language} songs sound to a native speaker. Listen to each song,
        read the lyrics, and rate it. Be as critical as you like; a low score helps us more than a polite one. The
        songs are AI-generated. We only store your ratings and optional comments, never your name or contact details.
      </p>
      {songs.length === 0 ? (
        <p className="mt-10 text-foreground/60">No songs have been added for this language yet. Please check back soon.</p>
      ) : (
        <ol className="mt-10 space-y-12">
          {songs.map((s) => (
            <li key={s.itemId}>
              <h2 className="text-xl font-medium">{s.title}</h2>
              {s.audioUrl ? (
                <audio controls preload="none" src={s.audioUrl} className="mt-3 w-full" />
              ) : (
                <p className="mt-3 text-sm text-foreground/60">Audio is unavailable right now.</p>
              )}
              <div className="mt-4 space-y-3 rounded-lg border border-muted/30 p-4 text-sm">
                {s.sections.map((sec, i) => (
                  <div key={i}>
                    <p className="text-xs uppercase tracking-widest text-foreground/40">{sec.type}</p>
                    <p lang={reviewer.language} className="whitespace-pre-line text-foreground/80">{sec.lyrics}</p>
                  </div>
                ))}
              </div>
              <RatingForm token={params.token} itemId={s.itemId} initial={s.mine} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
