"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { sendFunnelEvent } from "@/components/funnel-beacon";
import { canSetVolume, rampVolume } from "@/lib/station/fade";
import { useAmbientTint } from "@/components/use-ambient-tint";
import { InstallPrompt } from "@/components/install-prompt";
import { NAMED_STATIONS } from "@/lib/station/named";
import { usePlayer } from "@/components/player/player-provider";
import { expansionLanguage } from "@/lib/languages/registry";
import { UI_LANG_ENDONYM, type UiKey, isUiLang } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { reportClientError } from "@/lib/obs/report-client-error";
import { STATION_AUDIO_FAILED, STATION_QUEUE_EMPTY } from "@/lib/ops/station-health";
import { loadPrefs, savePrefs, STATION_MOODS, toggleMood } from "@/lib/station/prefs";
import { trackShareUrl, whatsappShareUrl } from "@/lib/station/share";
import { clearMediaSession, setMediaHandlers, setMediaMetadata, setMediaPlaybackState } from "@/lib/player/media-session";

interface Track {
  id: string;
  title: string;
  language: string;
  tags: string[];
  url: string;
  /** Templated host line from the queue API; shown as text on some track changes. */
  host?: string;
  durationSeconds?: number;
  /** Sets (lib/station/sets.ts, STATION_SETS=1): crossfade hints for tracks inside a block of same-language tracks. */
  fadeInMs?: number;
  fadeOutMs?: number;
  set?: { id: string; index: number; size: number };
  /** Present on house-ad / sponsor items spliced in by the queue API (lib/station/ads.ts). */
  type?: "ad" | "voice";
  /** Present on AI host links and idents spliced in by the queue API (lib/station/voice-links.ts). */
  voice?: { lineId: string; kind: string; text: string; aiMade: boolean; hour: number | null; fadeInMs: number };
  ad?: { slotId: string; label: string; headline: string; ctaLabel: string | null; ctaUrl: string | null; aiMade: boolean; skipAfterMs: number | null };
}

type Kind = "play" | "like" | "skip" | "replay" | "share" | "finish";

/** After this many tracks in a row fail to load, stop skipping and tell the listener instead of looping. */
const MAX_CONSECUTIVE_ERRORS = 3;
const HOST_EVERY = 3;
const HOST_VISIBLE_MS = 12_000;

const BASE_LANGS = ["", "hi", "ta", "te", "kn", "bn"];

/** Mood values are the tags sent to the server; these keys are only their labels. */
const MOOD_LABEL: Record<(typeof STATION_MOODS)[number], UiKey> = {
  joyful: "station.mood.joyful",
  calm: "station.mood.calm",
  romantic: "station.mood.romantic",
  devotional: "station.mood.devotional",
  energetic: "station.mood.energetic",
  nostalgic: "station.mood.nostalgic",
};

/** A pool language written in its own script when we have the name (hi, ta, ...), else as stored. */
function languageName(code: string): string {
  return isUiLang(code) ? UI_LANG_ENDONYM[code] : (expansionLanguage(code)?.endonym ?? code);
}

function postSignal(trackId: string, kind: Kind, audio: HTMLAudioElement | null, set?: { id: string; index: number }) {
  void fetch("/api/station/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ trackId, kind, positionMs: audio ? Math.round(audio.currentTime * 1000) : undefined, setId: set?.id, setIndex: set?.index }),
  });
}

type AdEventKind = "start" | "complete" | "tap";

/** House-ad log. Never a taste signal; the server ignores it entirely unless ADS_ENABLED=1. */
function postAdEvent(slotId: string, event: AdEventKind) {
  void fetch("/api/station/ad-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ slotId, event }),
  }).catch(() => undefined);
}

/** A card-only spot (no audio) holds the screen this long, then the station carries on. */
const AD_CARD_MS = 6_000;

/** House ads can be skipped after a few seconds; sponsor spots render no button at all. */
function AdSkip({ afterMs, onSkip }: { afterMs: number; onSkip: () => void }) {
  const [ready, setReady] = useState(afterMs <= 0);
  useEffect(() => {
    if (afterMs <= 0) return;
    const t = setTimeout(() => setReady(true), afterMs);
    return () => clearTimeout(t);
  }, [afterMs]);
  return <button type="button" disabled={!ready} onClick={onSkip} className="rounded border px-3 py-2 disabled:opacity-50">Skip</button>;
}
/** Ad seconds are counted over this window for the server's cap. */
const AD_WINDOW_MS = 600_000;
const AD_HOUR_MS = 3_600_000;

/** Visitors hear this many tracks before the sign-up nudge appears; playback never stops for it. */
const NUDGE_AFTER = 3;

type Energy = "up" | "down";

function queueUrl(language: string, energy: Energy | null, extra: { like?: string; exclude?: string; tags?: string[]; ads?: Record<string, string>; station?: string } = {}) {
  const q = new URLSearchParams({ limit: "10" });
  if (language) q.set("lang", language);
  if (energy) q.set("energy", energy);
  if (extra.like) q.set("like", extra.like);
  if (extra.exclude) q.set("exclude", extra.exclude);
  if (extra.tags?.length) q.set("tags", extra.tags.join(","));
  for (const [k, v] of Object.entries(extra.ads ?? {})) q.set(k, v);
  if (extra.station) q.set("station", extra.station);
  // The server programs by the listener's own clock; fall back silently if the browser will not say.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) q.set("tz", tz);
  } catch { /* no Intl: server falls back to India time */ }
  return `/api/station/queue?${q}`;
}

export function StationPlayer({ anonymous = false, extraLangs = [], betaLangs = [], initialStation = "" }: { anonymous?: boolean; extraLangs?: string[]; betaLangs?: string[]; initialStation?: string }) {
  const extraKey = extraLangs.join(",");
  const LANGS = useMemo(() => [...BASE_LANGS, ...(extraKey ? extraKey.split(",") : [])], [extraKey]);
  // Anonymous listeners are not stored: no per-listener signals leave the browser.
  const { t } = useUiLang();
  const sendSignal = anonymous ? () => {} : postSignal;
  const [played, setPlayed] = useState(0);
  const globalPlayer = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [lang, setLang] = useState<string>("");
  const [moods, setMoods] = useState<string[]>([]);
  // A named station ("Subah", "Raat", "Diwali Radio"); empty means the listener's own station.
  const [station, setStation] = useState<string>(initialStation);
  // "ready" flips once the saved choice has been read; "onboarded" is false on a first visit until Start is pressed.
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const [plays, setPlays] = useState(0);
  const [energy, setEnergy] = useState<Energy | null>(null);
  // Refills read it through a ref so a chip tap never restarts the language effect.
  const energyRef = useRef<Energy | null>(null);
  const errorsInARow = useRef(0);
  const tracksStarted = useRef(0);
  // Session counters for the ad caps; sent with each queue request (the server holds no per-session state).
  const adSession = useRef({ played: 0, since: 0, lastAdAt: null as number | null, seen: [] as string[], spots: [] as { at: number; sec: number }[] });
  // Session counters for the spoken links, sent the same way; they reset when the page reloads.
  const voiceSession = useRef({ since: 0, breaks: 0, seen: [] as string[], lastCheckHour: null as number | null });
  const currentId = useRef<string | null>(null);
  const fadeCancel = useRef<() => void>(() => undefined);
  const fadeOutStarted = useRef(false);
  const [hostLine, setHostLine] = useState<string | null>(null);
  const current = queue[0] ?? null;

  const adParams = useCallback((): Record<string, string> => {
    const a = adSession.current;
    const now = Date.now();
    const out: Record<string, string> = { played: String(a.played) };
    if (a.lastAdAt !== null) { out.since = String(a.since); out.adAge = String(Math.round((now - a.lastAdAt) / 1000)); }
    const sec = a.spots.filter((x) => now - x.at < AD_WINDOW_MS).reduce((n, x) => n + x.sec, 0);
    if (sec) out.adSec = String(sec);
    const hour = a.spots.filter((x) => now - x.at < AD_HOUR_MS).length;
    if (hour) out.adHr = String(hour);
    if (a.seen.length) out.seen = a.seen.join(",");
    return out;
  }, []);

  const voiceParams = useCallback((): Record<string, string> => {
    const v = voiceSession.current;
    const out: Record<string, string> = { vsince: String(v.since), vn: String(v.breaks) };
    if (v.seen.length) out.vseen = v.seen.slice(-30).join(",");
    if (v.lastCheckHour !== null) out.vhr = String(v.lastCheckHour);
    return out;
  }, []);

  const refill = useCallback(async (language: string, wanted: string[], stationSlug: string) => {
    setLoading(true);
    setQueueError(false);
    try {
      const res = await fetch(queueUrl(language, energyRef.current, { tags: wanted, station: stationSlug, ads: { ...adParams(), ...voiceParams() } }));
      if (!res.ok) throw new Error(`queue ${res.status}`);
      const data = (await res.json()) as { tracks?: Track[] };
      setQueue(data.tracks ?? []);
      if (!data.tracks?.length) reportClientError(STATION_QUEUE_EMPTY, { boundary: "window" });
    } catch {
      // Offline or a server error: say so and offer a retry instead of the "nothing to play" message.
      setQueue([]);
      setQueueError(true);
    }
    setLoading(false);
  }, [adParams, voiceParams]);

  useEffect(() => {
    const saved = loadPrefs();
    if (saved) { setLang(LANGS.includes(saved.lang) ? saved.lang : ""); setMoods(saved.moods); setOnboarded(true); }
    // A station link is a choice in itself: skip the first-visit picker.
    if (initialStation) setOnboarded(true);
    setReady(true);
  }, [LANGS, initialStation]);

  useEffect(() => {
    if (!ready || !onboarded) return;
    savePrefs({ lang, moods });
    void refill(lang, moods, station);
  }, [ready, onboarded, lang, moods, station, refill]);

  // Start playback when the head of the queue changes; stop the app-wide player so two songs never overlap.
  useEffect(() => {
    if (!current || !audioRef.current) return;
    globalPlayer.close();
    currentId.current = current.id;
    if (current.type === "ad" && current.ad) {
      // A card-only spot leaves ~6 s of silence, which can stall background audio on a locked phone: drop it when hidden.
      if (!current.url && typeof document !== "undefined" && document.hidden) { controls.current.skip(); return; }
      // A break: labelled, skippable, no taste signal, no host line. Card-only spots just hold the card for a few seconds.
      const a = adSession.current;
      a.since = 0;
      a.lastAdAt = Date.now();
      a.seen.push(current.ad.slotId);
      a.spots.push({ at: a.lastAdAt, sec: current.durationSeconds ?? AD_CARD_MS / 1000 });
      setHostLine(null);
      setBlocked(false);
      postAdEvent(current.ad.slotId, "start");
      if (current.url) {
        audioRef.current.src = current.url;
        void audioRef.current.play().catch(() => setBlocked(true));
      } else {
        const id = current.id;
        const t = setTimeout(() => { if (currentId.current === id) controls.current.finish(); }, AD_CARD_MS);
        // Locking the phone mid-card: end the spot now so the next track starts while the page can still play.
        const onHide = () => { if (document.hidden && currentId.current === id) controls.current.finish(); };
        document.addEventListener("visibilitychange", onHide);
        return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onHide); };
      }
      return;
    }
    if (current.type === "voice" && current.voice) {
      // A spoken link: no card, no taste signal, no host text. It counts toward the next break, not toward played tracks.
      const v = voiceSession.current;
      v.since = 0;
      v.breaks += 1;
      v.seen.push(current.voice.lineId);
      if (current.voice.hour !== null) v.lastCheckHour = current.voice.hour;
      setHostLine(null);
      setBlocked(false);
      audioRef.current.src = current.url;
      fadeCancel.current();
      fadeOutStarted.current = false;
      if (current.voice.fadeInMs && canSetVolume(audioRef.current)) {
        audioRef.current.volume = 0;
        fadeCancel.current = rampVolume(audioRef.current, 1, current.voice.fadeInMs);
      } else {
        try { audioRef.current.volume = 1; } catch { /* read-only on iOS */ }
      }
      void audioRef.current.play().catch(() => setBlocked(true));
      return;
    }
    adSession.current.played += 1;
    adSession.current.since += 1;
    voiceSession.current.since += 1;
    audioRef.current.src = current.url;
    // Tracks in a set dip out and in around the join; anything else always starts at full volume.
    fadeCancel.current();
    fadeOutStarted.current = false;
    if (current.fadeInMs && canSetVolume(audioRef.current)) {
      audioRef.current.volume = 0;
      fadeCancel.current = rampVolume(audioRef.current, 1, current.fadeInMs);
    } else {
      try { audioRef.current.volume = 1; } catch { /* read-only on iOS */ }
    }
    // A host line on the first track and then every third, so the station has a voice without chattering.
    const showHost = tracksStarted.current % HOST_EVERY === 0 && !!current.host;
    tracksStarted.current += 1;
    setHostLine(showHost ? current.host! : null);
    setBlocked(false);
    // Mobile browsers can refuse autoplay after a language change; show a tap target instead of silence.
    void audioRef.current.play().then(() => { sendSignal(current.id, "play", null, current.set); sendFunnelEvent(anonymous ? "station_play_anon" : "station_play_user"); setPlays((n) => n + 1); }).catch(() => setBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the head track id should restart playback
  }, [current?.id]);

  // Anonymous counters only (see /api/events): the third finished or skipped track, and the nudge appearing.
  useEffect(() => { if (played === NUDGE_AFTER) sendFunnelEvent("listened_3", { once: true }); }, [played]);
  const nudging = anonymous && played >= NUDGE_AFTER;
  const isAd = current?.type === "ad";
  const isVoice = current?.type === "voice";
  useEffect(() => { if (nudging) sendFunnelEvent("nudge_shown", { once: true }); }, [nudging]);

  function advance(kind: "skip" | "finish" | "error") {
    if (!current) return;
    const isAd = current.type === "ad";
    // Ads and spoken links are not listening taste: no signal, and skipping one is not a track skip.
    const notATrack = isAd || current.type === "voice";
    if (isAd && kind === "finish" && current.ad) postAdEvent(current.ad.slotId, "complete");
    if (kind !== "error" && !notATrack) setPlayed((n) => n + 1);
    if (kind !== "error" && !notATrack) sendSignal(current.id, kind, audioRef.current, current.set);
    if (queue.length <= 2) {
      // Refill from the server so the tail reflects what was just skipped or finished.
      void refill(lang, moods, station);
    } else {
      setQueue((q) => q.slice(1));
    }
  }

  function onTrackError() {
    // A spot or spoken link that will not load is dropped quietly; it is not a station audio failure.
    if (current?.type === "ad" || current?.type === "voice") { advance("skip"); return; }
    reportClientError(STATION_AUDIO_FAILED, { boundary: "window" });
    errorsInARow.current += 1;
    if (errorsInARow.current >= MAX_CONSECUTIVE_ERRORS) {
      setFailed(true);
      return;
    }
    advance("error");
  }

  useEffect(() => {
    if (!hostLine) return;
    const id = setTimeout(() => setHostLine(null), HOST_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [hostLine]);

  // Lock-screen and headset controls; handlers read the latest closure through a ref so they never go stale.
  const controls = useRef({ skip: () => {}, finish: () => {} });
  controls.current.skip = () => advance("skip");
  controls.current.finish = () => advance("finish");
  useEffect(() => {
    if (!current) return;
    setMediaMetadata({ title: current.title, artist: "neo-fm Station" });
    setMediaHandlers({
      play: () => void audioRef.current?.play(),
      pause: () => audioRef.current?.pause(),
      stop: () => audioRef.current?.pause(),
      seekBy: (d) => { if (audioRef.current) audioRef.current.currentTime += d; },
      seekTo: (t) => { if (audioRef.current) audioRef.current.currentTime = t; },
      next: () => controls.current.skip(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metadata follows the head track only
  }, [current?.id]);
  useEffect(() => clearMediaSession, []);

  function retry() {
    errorsInARow.current = 0;
    setFailed(false);
    void refill(lang, moods, station);
  }

  // Re-steer the upcoming tracks without touching the one playing, so a tap shows in what plays next.
  async function steerTail(next: Energy | null, likeId?: string) {
    if (!current) return;
    try {
      const res = await fetch(queueUrl(lang, next, { like: likeId, exclude: current.id, tags: moods, station, ads: { ...adParams(), ...voiceParams() } }));
      const data = (await res.json()) as { tracks?: Track[] };
      if (data.tracks?.length) setQueue((q) => (q[0]?.id === current.id ? [q[0], ...data.tracks!] : q));
    } catch { /* keep the current queue */ }
  }

  function chooseEnergy(dir: Energy) {
    const next = energy === dir ? null : dir;
    setEnergy(next);
    energyRef.current = next;
    setNote(next ? (next === "up" ? t("station.note.livelier") : t("station.note.calmer")) : t("station.note.usual"));
    void steerTail(next);
  }

  function moreLikeThis() {
    if (!current) return;
    if (!liked.has(current.id)) like();
    setNote(t("station.note.more"));
    void steerTail(energyRef.current, current.id);
  }

  function like() {
    if (!current || liked.has(current.id)) return;
    setLiked(new Set(liked).add(current.id));
    sendSignal(current.id, "like", audioRef.current);
  }

  function replay() {
    if (!current || !audioRef.current) return;
    sendSignal(current.id, "replay", audioRef.current);
    audioRef.current.currentTime = 0;
    void audioRef.current.play();
  }

  async function share() {
    if (!current) return;
    const text = t("station.shareText", { title: current.title });
    const url = trackShareUrl(current.id, location.origin);
    try {
      if (navigator.share) await navigator.share({ title: current.title, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setNote(t("station.note.copied")); }
      sendSignal(current.id, "share", audioRef.current);
      sendFunnelEvent("station_share");
    } catch { /* share sheet dismissed */ }
  }

  function shareWhatsApp() {
    if (!current) return;
    window.open(whatsappShareUrl(current.title, trackShareUrl(current.id, location.origin)), "_blank", "noopener,noreferrer");
    sendSignal(current.id, "share", audioRef.current);
    sendFunnelEvent("whatsapp_click");
  }

  useAmbientTint(current && !isAd && !isVoice ? current.id : null);

  const moodChips = (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.mood.label")}>
      {STATION_MOODS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={moods.includes(m)}
          onClick={() => setMoods((cur) => toggleMood(cur, m))}
          className="chip"
        >
          {t(MOOD_LABEL[m])}
        </button>
      ))}
    </div>
  );

  const stationRow = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Stations">
      <button type="button" aria-pressed={station === ""} onClick={() => setStation("")} className="chip">
        My station
      </button>
      {NAMED_STATIONS.map((n) => (
        <button
          key={n.slug}
          type="button"
          title={n.tagline}
          aria-pressed={station === n.slug}
          onClick={() => { setOnboarded(true); setStation(n.slug); }}
          className="chip"
        >
          {n.name}
        </button>
      ))}
    </div>
  );

  async function shareStation() {
    const named = NAMED_STATIONS.find((n) => n.slug === station);
    if (!named) return;
    const url = `${location.origin}/station?s=${named.slug}`;
    const text = `${named.name} on neo-fm Station: ${named.tagline}`;
    try {
      if (navigator.share) await navigator.share({ title: named.name, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setNote(t("station.note.copied")); }
    } catch { /* share sheet dismissed */ }
  }

  if (!ready) return <p>{t("station.loading")}</p>;

  if (!onboarded) {
    return (
      <section aria-label={t("station.setup.label")} className="glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-lg font-medium">{t("station.setup.title")}</h2>
        {stationRow}
        <p className="text-sm text-foreground/70">{t("station.setup.hint")}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.lang.label")}>
          {LANGS.map((l) => (
            <button
              key={l || "all"}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className="chip"
            >
              {l ? languageName(l) : t("station.lang.all")}{betaLangs.includes(l) ? " (beta)" : ""}
            </button>
          ))}
        </div>
        {moodChips}
        <button type="button" onClick={() => { setOnboarded(true); sendFunnelEvent("onboarding_done", { once: true }); }} className="self-start rounded-full bg-accent px-5 py-2.5 font-medium text-background">
          {t("station.setup.start")}
        </button>
      </section>
    );
  }

  return (
    <section aria-label={t("station.player.label")} className="flex flex-col gap-4">
      <InstallPrompt plays={plays} minPlays={2} />
      {stationRow}
      {station ? (
        <p className="text-sm text-foreground/70">
          {NAMED_STATIONS.find((n) => n.slug === station)?.tagline}{" "}
          <button type="button" onClick={shareStation} className="underline">Share this station</button>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.lang.label")}>
        {LANGS.map((l) => (
          <button
            key={l || "all"}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className="chip"
          >
            {l ? languageName(l) : t("station.lang.all")}{betaLangs.includes(l) ? " (beta)" : ""}
          </button>
        ))}
      </div>
      {moodChips}

      {loading && !current ? <p>{t("station.loading")}</p> : null}
      {!loading && !current && queueError ? (
        <p role="alert" className="text-sm">
          {t("station.queueError")} <button type="button" onClick={retry} className="underline">{t("station.retry")}</button>
        </p>
      ) : null}
      {!loading && !current && !queueError ? <p>{t("station.empty")}</p> : null}

      {current ? (
        <div className="glass flex flex-col gap-4 rounded-3xl p-5 sm:p-6">
          {hostLine ? <p role="status" className="text-sm italic text-foreground/70">{hostLine}</p> : null}
          {isAd && current.ad ? (
            <div className="flex flex-col gap-2" aria-label="Ad">
              <p className="flex items-center gap-2 text-xs text-foreground/80">
                <span className="rounded-full border px-2 py-0.5">{current.ad.label}</span>
                {current.ad.aiMade ? <span className="rounded-full border px-2 py-0.5">AI-made</span> : null}
              </p>
              <p className="text-lg font-medium">{current.ad.headline}</p>
              {current.ad.ctaUrl && current.ad.ctaLabel ? (
                <a
                  href={current.ad.ctaUrl}
                  target={current.ad.ctaUrl.startsWith("/") ? undefined : "_blank"}
                  rel="noopener noreferrer sponsored"
                  onClick={() => postAdEvent(current.ad!.slotId, "tap")}
                  className="self-start rounded-full bg-accent px-4 py-2 font-medium text-background"
                >
                  {current.ad.ctaLabel}
                </a>
              ) : null}
            </div>
          ) : isVoice && current.voice ? (
            <div className="flex flex-col gap-2" aria-label="Station host">
              <p className="flex items-center gap-2 text-xs text-foreground/80">
                <span className="rounded-full border px-2 py-0.5">neo-fm</span>
                <span className="rounded-full border px-2 py-0.5">AI host</span>
              </p>
              <p className="text-base italic text-foreground/90">{current.voice.text}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="orb" data-paused={blocked ? "true" : "false"} aria-hidden />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-accent">
                    <span className="eq" aria-hidden><i /><i /><i /><i /></span>
                    {t("station.title")}
                  </p>
                  <p className="mt-1 truncate text-xl font-semibold sm:text-2xl">{current.title}</p>
                </div>
              </div>
              <p className="text-xs text-foreground/80">
                <span className="mr-2 rounded border border-foreground/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{t("station.aiLabel")}</span>
                {languageName(current.language)} · {current.tags.slice(0, 4).join(", ")}
              </p>
            </>
          )}
          <audio
            ref={audioRef}
            controls={!isAd && !isVoice}
            className={isAd || isVoice ? "hidden" : "w-full"}
            onEnded={() => advance("finish")}
            onPlaying={() => { errorsInARow.current = 0; setBlocked(false); setMediaPlaybackState(true); }}
            onPause={() => setMediaPlaybackState(false)}
            onTimeUpdate={(e) => {
              const a = e.currentTarget;
              if (!current.fadeOutMs || fadeOutStarted.current || !Number.isFinite(a.duration)) return;
              if ((a.duration - a.currentTime) * 1000 <= current.fadeOutMs && canSetVolume(a)) {
                fadeOutStarted.current = true;
                fadeCancel.current();
                fadeCancel.current = rampVolume(a, 0, current.fadeOutMs);
              }
            }}
            onError={onTrackError}
          />
          {queue[1]?.url ? <audio key={queue[1].id} src={queue[1].url} preload="auto" hidden aria-hidden="true" /> : null}
          {blocked ? (
            <button type="button" onClick={() => void audioRef.current?.play()} className="rounded-full bg-accent px-4 py-2 font-medium text-background">
              {t("station.tapToPlay")}
            </button>
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm">
              {t("station.failed")} <button type="button" onClick={retry} className="underline">{t("station.retry")}</button>
            </p>
          ) : null}
          {isAd ? (
            <div className="flex flex-wrap gap-2">
              {current.ad?.skipAfterMs != null ? <AdSkip key={current.id} afterMs={current.ad.skipAfterMs} onSkip={() => advance("skip")} /> : null}
            </div>
          ) : isVoice ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => advance("skip")} className="chip py-2">{t("station.skip")}</button>
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={like} aria-pressed={liked.has(current.id)} className="chip py-2">
              {liked.has(current.id) ? t("station.liked") : t("station.like")}
            </button>
            <button type="button" onClick={replay} className="chip py-2">{t("station.replay")}</button>
            <button type="button" onClick={() => advance("skip")} className="chip py-2">{t("station.skip")}</button>
            <button type="button" onClick={share} className="chip py-2">{t("station.share")}</button>
            <button type="button" onClick={shareWhatsApp} className="rounded-full bg-[#25D366] px-4 py-2 font-medium text-black hover:brightness-95">Send on WhatsApp</button>
          </div>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.steer.label")} hidden={isAd || isVoice}>
            <button type="button" onClick={moreLikeThis} className="chip">{t("station.steer.more")}</button>
            <button type="button" onClick={() => chooseEnergy("down")} aria-pressed={energy === "down"} className="chip">{t("station.steer.calmer")}</button>
            <button type="button" onClick={() => chooseEnergy("up")} aria-pressed={energy === "up"} className="chip">{t("station.steer.livelier")}</button>
          </div>
          {note ? <p role="status" className="text-sm">{note}</p> : null}
          {nudging ? (
            <div className="flex flex-col gap-2 rounded border border-accent/40 bg-accent/10 p-3 text-sm">
              <p>{t("station.nudge.text")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <a href="/sign-up?next=%2Fstation" onClick={() => sendFunnelEvent("nudge_clicked")} className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-accent px-5 text-sm font-medium text-background hover:bg-accent/90">{t("station.nudge.signUp")}</a>
                <a href="/sign-in?next=%2Fstation" className="inline-flex min-h-[44px] items-center px-2 underline">{t("station.nudge.signIn")}</a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
