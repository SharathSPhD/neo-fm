"use client";

import { useEffect, useState } from "react";

import { CoverArt } from "@/components/cover-art";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { segmentKind, type SegmentKind } from "@/lib/station/now-playing";
import { SLEEP_MINUTES, sleepMinutesLeft, type SleepMinutes } from "@/lib/station/sleep-timer";

/**
 * Premium now-playing pieces (flag STATION_NOW_PLAYING): generated cover, a segment marker, an up-next peek and the sleep
 * timer. The cover is the app's deterministic gradient keyed off the track, so no image is fetched or paid for.
 */

export function NowPlayingCover({ id, style, paused }: { id: string; style?: string; paused: boolean }) {
  return (
    <div
      className="relative size-24 shrink-0 overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/10 sm:size-32"
      data-testid="np-cover"
      data-paused={paused ? "true" : "false"}
      aria-hidden
    >
      <CoverArt url={null} seed={id} styleFamily={style ?? null} alt="" />
      {paused ? null : <span className="eq absolute bottom-2 left-2" aria-hidden><i /><i /><i /><i /></span>}
    </div>
  );
}

const KIND_KEY = { track: "station.np.nowPlaying", ad: "station.np.adBreak", voice: "station.np.host" } as const;

export function SegmentMarker({ kind }: { kind: SegmentKind }) {
  const { t } = useUiLang();
  return (
    <p
      className={`inline-flex items-center gap-2 self-start rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-widest ${
        kind === "track" ? "border-accent/50 text-accent" : "border-foreground/40 text-foreground/90"
      }`}
      data-testid="np-marker"
      data-kind={kind}
    >
      {t(KIND_KEY[kind])}
    </p>
  );
}

export function UpNextPeek({ next }: { next: { type?: "ad" | "voice"; title: string; language: string } | null }) {
  const { t } = useUiLang();
  if (!next) return null;
  const kind = segmentKind(next);
  return (
    <p className="flex min-w-0 items-baseline gap-2 text-sm text-foreground/80" data-testid="np-upnext">
      <span className="shrink-0 text-xs uppercase tracking-widest text-foreground/70">{t("station.np.upNext")}</span>
      <span className="truncate">{kind === "track" ? next.title : t(KIND_KEY[kind])}</span>
    </p>
  );
}

export function SleepTimer({ endsAt, onSet }: { endsAt: number | null; onSet: (minutes: SleepMinutes | null) => void }) {
  const { t } = useUiLang();
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<SleepMinutes | null>(null);
  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [endsAt]);
  const left = sleepMinutesLeft(endsAt, now);
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={t("station.np.sleep")} data-testid="np-sleep">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-foreground/70">{t("station.np.sleep")}</span>
        <button type="button" onClick={() => { setPicked(null); onSet(null); }} aria-pressed={endsAt === null} className="chip">
          {t("station.np.sleepOff")}
        </button>
        {SLEEP_MINUTES.map((m) => (
          <button key={m} type="button" onClick={() => { setPicked(m); onSet(m); }} aria-pressed={endsAt !== null && picked === m} className="chip">
            {t("station.np.sleepMin", { n: m })}
          </button>
        ))}
      </div>
      {endsAt !== null ? <p className="text-xs text-foreground/70" role="status">{t("station.np.sleepLeft", { n: Math.max(left, 1) })}</p> : null}
    </div>
  );
}
