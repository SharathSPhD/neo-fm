"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sendFunnelEvent } from "@/components/funnel-beacon";
import { InstallPrompt } from "@/components/install-prompt";
import { usePlayer } from "@/components/player/player-provider";
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
  /** Present on house-ad / sponsor items spliced in by the queue API (lib/station/ads.ts). */
  type?: "ad";
  ad?: { slotId: string; label: string; headline: string; ctaLabel: string | null; ctaUrl: string | null; aiMade: boolean };
}

type Kind = "play" | "like" | "skip" | "replay" | "share" | "finish";

/** After this many tracks in a row fail to load, stop skipping and tell the listener instead of looping. */
const MAX_CONSECUTIVE_ERRORS = 3;
const HOST_EVERY = 3;
const HOST_VISIBLE_MS = 12_000;

const LANGS = ["", "hi", "ta", "te", "kn", "bn"] as const;

function postSignal(trackId: string, kind: Kind, audio: HTMLAudioElement | null) {
  void fetch("/api/station/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ trackId, kind, positionMs: audio ? Math.round(audio.currentTime * 1000) : undefined }),
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
/** Ad seconds are counted over this window for the server's cap. */
const AD_WINDOW_MS = 600_000;

/** Visitors hear this many tracks before the sign-up nudge appears; playback never stops for it. */
const NUDGE_AFTER = 3;

type Energy = "up" | "down";

function queueUrl(language: string, energy: Energy | null, extra: { like?: string; exclude?: string; tags?: string[]; ads?: Record<string, string> } = {}) {
  const q = new URLSearchParams({ limit: "10" });
  if (language) q.set("lang", language);
  if (energy) q.set("energy", energy);
  if (extra.like) q.set("like", extra.like);
  if (extra.exclude) q.set("exclude", extra.exclude);
  if (extra.tags?.length) q.set("tags", extra.tags.join(","));
  for (const [k, v] of Object.entries(extra.ads ?? {})) q.set(k, v);
  // The server programs by the listener's own clock; fall back silently if the browser will not say.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) q.set("tz", tz);
  } catch { /* no Intl: server falls back to India time */ }
  return `/api/station/queue?${q}`;
}

export function StationPlayer({ anonymous = false }: { anonymous?: boolean }) {
  // Anonymous listeners are not stored: no per-listener signals leave the browser.
  const sendSignal = anonymous ? () => {} : postSignal;
  const [played, setPlayed] = useState(0);
  const globalPlayer = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [lang, setLang] = useState<string>("");
  const [moods, setMoods] = useState<string[]>([]);
  // "ready" flips once the saved choice has been read; "onboarded" is false on a first visit until Start is pressed.
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [plays, setPlays] = useState(0);
  const [energy, setEnergy] = useState<Energy | null>(null);
  // Refills read it through a ref so a chip tap never restarts the language effect.
  const energyRef = useRef<Energy | null>(null);
  const errorsInARow = useRef(0);
  const tracksStarted = useRef(0);
  // Session counters for the ad caps; sent with each queue request (the server holds no per-session state).
  const adSession = useRef({ played: 0, since: 0, lastAdAt: null as number | null, seen: [] as string[], spots: [] as { at: number; sec: number }[] });
  const currentId = useRef<string | null>(null);
  const [hostLine, setHostLine] = useState<string | null>(null);
  const current = queue[0] ?? null;

  const adParams = useCallback((): Record<string, string> => {
    const a = adSession.current;
    const now = Date.now();
    const out: Record<string, string> = { played: String(a.played) };
    if (a.lastAdAt !== null) { out.since = String(a.since); out.adAge = String(Math.round((now - a.lastAdAt) / 1000)); }
    const sec = a.spots.filter((x) => now - x.at < AD_WINDOW_MS).reduce((n, x) => n + x.sec, 0);
    if (sec) out.adSec = String(sec);
    if (a.seen.length) out.seen = a.seen.join(",");
    return out;
  }, []);

  const refill = useCallback(async (language: string, wanted: string[]) => {
    setLoading(true);
    try {
      const res = await fetch(queueUrl(language, energyRef.current, { tags: wanted, ads: adParams() }));
      const data = (await res.json()) as { tracks?: Track[] };
      setQueue(data.tracks ?? []);
      if (!data.tracks?.length) reportClientError(STATION_QUEUE_EMPTY, { boundary: "window" });
    } catch {
      setQueue([]);
    }
    setLoading(false);
  }, [adParams]);

  useEffect(() => {
    const saved = loadPrefs();
    if (saved) { setLang(saved.lang); setMoods(saved.moods); setOnboarded(true); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !onboarded) return;
    savePrefs({ lang, moods });
    void refill(lang, moods);
  }, [ready, onboarded, lang, moods, refill]);

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
    adSession.current.played += 1;
    adSession.current.since += 1;
    audioRef.current.src = current.url;
    // A host line on the first track and then every third, so the station has a voice without chattering.
    const showHost = tracksStarted.current % HOST_EVERY === 0 && !!current.host;
    tracksStarted.current += 1;
    setHostLine(showHost ? current.host! : null);
    setBlocked(false);
    // Mobile browsers can refuse autoplay after a language change; show a tap target instead of silence.
    void audioRef.current.play().then(() => { sendSignal(current.id, "play", null); sendFunnelEvent(anonymous ? "station_play_anon" : "station_play_user"); setPlays((n) => n + 1); }).catch(() => setBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the head track id should restart playback
  }, [current?.id]);

  // Anonymous counters only (see /api/events): the third finished or skipped track, and the nudge appearing.
  useEffect(() => { if (played === NUDGE_AFTER) sendFunnelEvent("listened_3", { once: true }); }, [played]);
  const nudging = anonymous && played >= NUDGE_AFTER;
  const isAd = current?.type === "ad";
  useEffect(() => { if (nudging) sendFunnelEvent("nudge_shown", { once: true }); }, [nudging]);

  function advance(kind: "skip" | "finish" | "error") {
    if (!current) return;
    const isAd = current.type === "ad";
    if (isAd && kind === "finish" && current.ad) postAdEvent(current.ad.slotId, "complete");
    // Ads are not listening taste: no signal, and skipping one is not a track skip.
    if (kind !== "error" && !isAd) setPlayed((n) => n + 1);
    if (kind !== "error" && !isAd) sendSignal(current.id, kind, audioRef.current);
    if (queue.length <= 2) {
      // Refill from the server so the tail reflects what was just skipped or finished.
      void refill(lang, moods);
    } else {
      setQueue((q) => q.slice(1));
    }
  }

  function onTrackError() {
    // A spot that will not load is dropped quietly; it is not a station audio failure.
    if (current?.type === "ad") { advance("skip"); return; }
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
    void refill(lang, moods);
  }

  // Re-steer the upcoming tracks without touching the one playing, so a tap shows in what plays next.
  async function steerTail(next: Energy | null, likeId?: string) {
    if (!current) return;
    try {
      const res = await fetch(queueUrl(lang, next, { like: likeId, exclude: current.id, tags: moods, ads: adParams() }));
      const data = (await res.json()) as { tracks?: Track[] };
      if (data.tracks?.length) setQueue((q) => (q[0]?.id === current.id ? [q[0], ...data.tracks!] : q));
    } catch { /* keep the current queue */ }
  }

  function chooseEnergy(dir: Energy) {
    const next = energy === dir ? null : dir;
    setEnergy(next);
    energyRef.current = next;
    setNote(next ? (next === "up" ? "Livelier tracks coming up" : "Calmer tracks coming up") : "Back to the usual mix");
    void steerTail(next);
  }

  function moreLikeThis() {
    if (!current) return;
    if (!liked.has(current.id)) like();
    setNote("More like this coming up");
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
    const text = `${current.title} on neo-fm Station`;
    const url = trackShareUrl(current.id, location.origin);
    try {
      if (navigator.share) await navigator.share({ title: current.title, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setNote("Link copied"); }
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

  const moodChips = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Mood (pick up to two)">
      {STATION_MOODS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={moods.includes(m)}
          onClick={() => setMoods((cur) => toggleMood(cur, m))}
          className={`rounded-full border px-3 py-1 text-sm ${moods.includes(m) ? "bg-primary text-primary-foreground" : ""}`}
        >
          {m}
        </button>
      ))}
    </div>
  );

  if (!ready) return <p>Loading…</p>;

  if (!onboarded) {
    return (
      <section aria-label="Set up your station" className="flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-lg font-medium">What do you want to hear?</h2>
        <p className="text-sm text-muted-foreground">Pick a language and up to two moods. You can change them any time.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l || "all"}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`rounded-full border px-3 py-1 text-sm ${lang === l ? "bg-primary text-primary-foreground" : ""}`}
            >
              {l || "All"}
            </button>
          ))}
        </div>
        {moodChips}
        <button type="button" onClick={() => { setOnboarded(true); sendFunnelEvent("onboarding_done", { once: true }); }} className="self-start rounded bg-primary px-4 py-2 text-primary-foreground">
          Start my station
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Station player" className="flex flex-col gap-4">
      <InstallPrompt plays={plays} minPlays={2} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Language">
        {LANGS.map((l) => (
          <button
            key={l || "all"}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`rounded-full border px-3 py-1 text-sm ${lang === l ? "bg-primary text-primary-foreground" : ""}`}
          >
            {l || "All"}
          </button>
        ))}
      </div>
      {moodChips}

      {loading && !current ? <p>Loading…</p> : null}
      {!loading && !current ? <p>Nothing to play yet. Check back soon.</p> : null}

      {current ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {hostLine ? <p role="status" className="text-sm italic text-muted-foreground">{hostLine}</p> : null}
          {isAd && current.ad ? (
            <div className="flex flex-col gap-2" aria-label="Ad">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
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
                  className="self-start rounded bg-primary px-3 py-2 text-primary-foreground"
                >
                  {current.ad.ctaLabel}
                </a>
              ) : null}
            </div>
          ) : (
            <>
              <p className="text-lg font-medium">{current.title}</p>
              <p className="text-xs text-muted-foreground">{current.language} · {current.tags.slice(0, 4).join(", ")}</p>
            </>
          )}
          <audio
            ref={audioRef}
            controls={!isAd}
            className={isAd ? "hidden" : "w-full"}
            onEnded={() => advance("finish")}
            onPlaying={() => { errorsInARow.current = 0; setBlocked(false); setMediaPlaybackState(true); }}
            onPause={() => setMediaPlaybackState(false)}
            onError={onTrackError}
          />
          {queue[1]?.url ? <audio key={queue[1].id} src={queue[1].url} preload="auto" hidden aria-hidden="true" /> : null}
          {blocked ? (
            <button type="button" onClick={() => void audioRef.current?.play()} className="rounded bg-primary px-3 py-2 text-primary-foreground">
              Tap to play
            </button>
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm">
              Songs are not loading right now. <button type="button" onClick={retry} className="underline">Try again</button>
            </p>
          ) : null}
          {isAd ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => advance("skip")} className="rounded border px-3 py-2">Skip</button>
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={like} aria-pressed={liked.has(current.id)} className="rounded border px-3 py-2">
              {liked.has(current.id) ? "Liked" : "Like"}
            </button>
            <button type="button" onClick={replay} className="rounded border px-3 py-2">Replay</button>
            <button type="button" onClick={() => advance("skip")} className="rounded border px-3 py-2">Skip</button>
            <button type="button" onClick={share} className="rounded border px-3 py-2">Share</button>
            <button type="button" onClick={shareWhatsApp} className="rounded border px-3 py-2">WhatsApp</button>
          </div>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Steer the station" hidden={isAd}>
            <button type="button" onClick={moreLikeThis} className="rounded-full border px-3 py-1 text-sm">More like this</button>
            <button type="button" onClick={() => chooseEnergy("down")} aria-pressed={energy === "down"} className={`rounded-full border px-3 py-1 text-sm ${energy === "down" ? "bg-primary text-primary-foreground" : ""}`}>Calmer</button>
            <button type="button" onClick={() => chooseEnergy("up")} aria-pressed={energy === "up"} className={`rounded-full border px-3 py-1 text-sm ${energy === "up" ? "bg-primary text-primary-foreground" : ""}`}>Livelier</button>
          </div>
          {note ? <p role="status" className="text-sm">{note}</p> : null}
          {nudging ? (
            <div className="flex flex-col gap-2 rounded border border-primary/40 bg-primary/5 p-3 text-sm">
              <p>Enjoying the station? Sign up free to save what you like and get music tuned to you.</p>
              <div className="flex gap-3">
                <a href="/sign-up?next=%2Fstation" onClick={() => sendFunnelEvent("nudge_clicked")} className="rounded bg-primary px-3 py-1 text-primary-foreground">Sign up free</a>
                <a href="/sign-in?next=%2Fstation" className="px-1 py-1 underline">Sign in</a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
