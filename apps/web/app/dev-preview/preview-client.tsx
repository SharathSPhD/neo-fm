"use client";

import { useEffect, useState } from "react";

import { KaraokeTicker } from "@/app/(app)/songs/[id]/karaoke-ticker";
import { SongAudio } from "@/app/(app)/songs/[id]/song-audio";
import { PromptTab } from "@/app/(app)/songs/new/prompt-tab";

const SECTIONS = [
  { id: "s1", type: "mukhda", target_seconds: 12, lyrics: "बारिश की पहली बूँद गिरी\nमन में तेरी याद जगी\nतानपुरे की धुन पर\nसाँस मेरी गुनगुनाने लगी" },
  { id: "s2", type: "interlude", target_seconds: 6 },
  { id: "s3", type: "antara", target_seconds: 12, lyrics: "दूर देस से आई हवा\nकहती है तू अब भी यहीं\nछत पर भीगी चाँदनी\nलौट आ, लौट आ, कहीं" },
];

/** Silent 30 s mono WAV so the lyric panel has a real <audio> to follow. */
function silentWavUrl(seconds: number): string {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export function PreviewClient() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const u = silentWavUrl(30);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, []);
  return (
    <>
      <PromptTab showGuide />
      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-widest text-foreground/60">Playback</h2>
        {src ? (
          <SongAudio songId="demo" initialUrl={src} durationSeconds={30} format="wav" title="बारिश की पहली बूँद" subtitle="Hindustani · Hindi" />
        ) : null}
        {src ? <KaraokeTicker sections={SECTIONS} durationSeconds={30} /> : null}
      </section>
    </>
  );
}
