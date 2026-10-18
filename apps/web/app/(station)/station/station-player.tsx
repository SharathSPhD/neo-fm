"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sendFunnelEvent } from "@/components/funnel-beacon";
import { InstallPrompt } from "@/components/install-prompt";
import { usePlayer } from "@/components/player/player-provider";
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
}

type Kind = "play" | "like" | "skip" | "replay" | "share" | "finish";

/** After this many tracks in a row fail to load, stop skipping and tell the listener instead of looping. */
const MAX_CONSECUTIVE_ERRORS = 3;
const HOST_EVERY = 3;
const HOST_VISIBLE_MS = 12_000;

const LANGS = ["", "hi", "ta", "te", "kn", "bn"] as const;

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
  return isUiLang(code) ? UI_LANG_ENDONYM[code] : code;
}

function postSignal(trackId: string, kind: Kind, audio: HTMLAudioElement | null) {
  void fetch("/api/station/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ trackId, kind, positionMs: audio ? Math.round(audio.currentTime * 1000) : undefined }),
  });
}

/** Visitors hear this many tracks before the sign-up nudge appears; playback never stops for it. */
const NUDGE_AFTER = 3;

type Energy = "up" | "down";

function queueUrl(language: string, energy: Energy | null, extra: { like?: string; exclude?: string; tags?: string[] } = {}) {
  const q = new URLSearchParams({ limit: "10" });
  if (language) q.set("lang", language);
  if (energy) q.set("energy", energy);
  if (extra.like) q.set("like", extra.like);
  if (extra.exclude) q.set("exclude", extra.exclude);
  if (extra.tags?.length) q.set("tags", extra.tags.join(","));
  // The server programs by the listener's own clock; fall back silently if the browser will not say.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) q.set("tz", tz);
  } catch { /* no Intl: server falls back to India time */ }
  return `/api/station/queue?${q}`;
}

export function StationPlayer({ anonymous = false }: { anonymous?: boolean }) {
  // Anonymous listeners are not stored: no per-listener signals leave the browser.
  const { t } = useUiLang();
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
  const [queueError, setQueueError] = useState(false);
  const [plays, setPlays] = useState(0);
  const [energy, setEnergy] = useState<Energy | null>(null);
  // Refills read it through a ref so a chip tap never restarts the language effect.
  const energyRef = useRef<Energy | null>(null);
  const errorsInARow = useRef(0);
  const tracksStarted = useRef(0);
  const [hostLine, setHostLine] = useState<string | null>(null);
  const current = queue[0] ?? null;

  const refill = useCallback(async (language: string, wanted: string[]) => {
    setLoading(true);
    setQueueError(false);
    try {
      const res = await fetch(queueUrl(language, energyRef.current, { tags: wanted }));
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
  }, []);

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
  useEffect(() => { if (nudging) sendFunnelEvent("nudge_shown", { once: true }); }, [nudging]);

  function advance(kind: "skip" | "finish" | "error") {
    if (!current) return;
    if (kind !== "error") setPlayed((n) => n + 1);
    if (kind !== "error") sendSignal(current.id, kind, audioRef.current);
    if (queue.length <= 2) {
      // Refill from the server so the tail reflects what was just skipped or finished.
      void refill(lang, moods);
    } else {
      setQueue((q) => q.slice(1));
    }
  }

  function onTrackError() {
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
  const controls = useRef({ skip: () => {} });
  controls.current.skip = () => advance("skip");
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
      const res = await fetch(queueUrl(lang, next, { like: likeId, exclude: current.id, tags: moods }));
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

  const moodChips = (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.mood.label")}>
      {STATION_MOODS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={moods.includes(m)}
          onClick={() => setMoods((cur) => toggleMood(cur, m))}
          className={`rounded-full border px-3 py-1 text-sm ${moods.includes(m) ? "bg-accent text-background" : ""}`}
        >
          {t(MOOD_LABEL[m])}
        </button>
      ))}
    </div>
  );

  if (!ready) return <p>{t("station.loading")}</p>;

  if (!onboarded) {
    return (
      <section aria-label={t("station.setup.label")} className="flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-lg font-medium">{t("station.setup.title")}</h2>
        <p className="text-sm text-foreground/70">{t("station.setup.hint")}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.lang.label")}>
          {LANGS.map((l) => (
            <button
              key={l || "all"}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`rounded-full border px-3 py-1 text-sm ${lang === l ? "bg-accent text-background" : ""}`}
            >
              {l ? languageName(l) : t("station.lang.all")}
            </button>
          ))}
        </div>
        {moodChips}
        <button type="button" onClick={() => { setOnboarded(true); sendFunnelEvent("onboarding_done", { once: true }); }} className="self-start rounded bg-accent px-4 py-2 text-background">
          {t("station.setup.start")}
        </button>
      </section>
    );
  }

  return (
    <section aria-label={t("station.player.label")} className="flex flex-col gap-4">
      <InstallPrompt plays={plays} minPlays={2} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.lang.label")}>
        {LANGS.map((l) => (
          <button
            key={l || "all"}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`rounded-full border px-3 py-1 text-sm ${lang === l ? "bg-accent text-background" : ""}`}
          >
            {l ? languageName(l) : t("station.lang.all")}
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
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {hostLine ? <p role="status" className="text-sm italic text-foreground/70">{hostLine}</p> : null}
          <p className="text-lg font-medium">{current.title}</p>
          <p className="text-xs text-foreground/70">{languageName(current.language)} · {current.tags.slice(0, 4).join(", ")}</p>
          <audio
            ref={audioRef}
            controls
            className="w-full"
            onEnded={() => advance("finish")}
            onPlaying={() => { errorsInARow.current = 0; setBlocked(false); setMediaPlaybackState(true); }}
            onPause={() => setMediaPlaybackState(false)}
            onError={onTrackError}
          />
          {queue[1] ? <audio key={queue[1].id} src={queue[1].url} preload="auto" hidden aria-hidden="true" /> : null}
          {blocked ? (
            <button type="button" onClick={() => void audioRef.current?.play()} className="rounded bg-accent px-3 py-2 text-background">
              {t("station.tapToPlay")}
            </button>
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm">
              {t("station.failed")} <button type="button" onClick={retry} className="underline">{t("station.retry")}</button>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={like} aria-pressed={liked.has(current.id)} className="rounded border px-3 py-2">
              {liked.has(current.id) ? t("station.liked") : t("station.like")}
            </button>
            <button type="button" onClick={replay} className="rounded border px-3 py-2">{t("station.replay")}</button>
            <button type="button" onClick={() => advance("skip")} className="rounded border px-3 py-2">{t("station.skip")}</button>
            <button type="button" onClick={share} className="rounded border px-3 py-2">{t("station.share")}</button>
            <button type="button" onClick={shareWhatsApp} className="rounded border px-3 py-2">WhatsApp</button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.steer.label")}>
            <button type="button" onClick={moreLikeThis} className="rounded-full border px-3 py-1 text-sm">{t("station.steer.more")}</button>
            <button type="button" onClick={() => chooseEnergy("down")} aria-pressed={energy === "down"} className={`rounded-full border px-3 py-1 text-sm ${energy === "down" ? "bg-accent text-background" : ""}`}>{t("station.steer.calmer")}</button>
            <button type="button" onClick={() => chooseEnergy("up")} aria-pressed={energy === "up"} className={`rounded-full border px-3 py-1 text-sm ${energy === "up" ? "bg-accent text-background" : ""}`}>{t("station.steer.livelier")}</button>
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
