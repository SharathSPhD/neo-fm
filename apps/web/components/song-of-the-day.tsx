import Link from "next/link";

import { loadChart } from "@/lib/charts/load";
import { pickSongOfTheDay } from "@/lib/charts/pick";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

/** Featured song, rotating daily through the week's top 5. Renders nothing without a qualifying song. */
export async function SongOfTheDay() {
  const song = pickSongOfTheDay(await loadChart(null, 7, 5));
  if (!song) return null;
  return (
    <section
      aria-labelledby="sotd-heading"
      className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-5"
    >
      <p id="sotd-heading" className="text-[11px] uppercase tracking-widest text-accent/80">
        Song of the day
      </p>
      <Link
        href={`/s/${song.public_id}`}
        className="text-2xl font-medium tracking-tight hover:underline focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {song.title || "Untitled"}
      </Link>
      <p className="text-sm text-foreground/60">
        {prettyLanguage(song.language)} · {prettyStyle(song.style_family)}
      </p>
      <p className="text-xs text-foreground/50">
        Picked from this week&apos;s most-loved songs.
      </p>
    </section>
  );
}
