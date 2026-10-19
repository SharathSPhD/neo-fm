/**
 * Spoken segments in the station queue: an AI host link, a daypart or station ident, optionally a time check, spliced in
 * between songs (strategy/av-elements.md). The lines are pre-rendered Gemini TTS files from the media lab, served as static
 * files from /voice, so playing one costs nothing. Off unless STATION_VOICE_LINKS=1.
 *
 * Pure rules, like lib/station/ads.ts: which line may play, where it may sit, and how often. The queue route does the I/O.
 * A voice segment is never a taste signal, never sits inside a crossfaded set, and never touches an ad break.
 */
import raw from "./voice-lines.json";
import { daypartOf, type Daypart } from "./program";

export type VoiceKind = "host-link" | "ident-daypart" | "time-check" | "ident-station" | "programme";

export interface VoiceLine {
  id: string;
  kind: VoiceKind;
  lang: string;
  daypart?: Daypart;
  /** Time checks only: the hour (0-23) the line announces. */
  hour?: number;
  seconds: number;
  text: string;
}

export const VOICE_LINES = raw as VoiceLine[];

/** The first break sits after this many tracks; later ones follow every EVERY tracks (counted from the last break). */
export const VOICE_CAPS = { firstAfterTracks: 2, everyTracks: 3, seenWindow: 30 } as const;

export function voiceLinksEnabled(): boolean {
  return process.env.STATION_VOICE_LINKS === "1";
}

/**
 * Time-check lines state the exact hour ("it is seven o'clock"), but a queue is built up to ~25 minutes before its last
 * track plays, so they only run when STATION_VOICE_TIMECHECK=1 (needs minute-aware placement before it is safe to enable).
 */
export function timeChecksEnabled(): boolean {
  return process.env.STATION_VOICE_TIMECHECK === "1";
}

/** Session counters the player sends with each queue request. Untrusted: they can only make breaks rarer or more frequent for that listener. */
export interface VoiceClientState {
  /** Tracks started this session (the same counter the ad caps read). */
  played: number;
  /** Tracks started since the last voice break; equals `played` when there has been none. */
  since: number;
  /** Voice breaks so far this session; decides which kind comes next. */
  breaks: number;
  seen: string[];
  /** Hour of the last time check, or null. */
  lastCheckHour: number | null;
}

const int = (v: string | null, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : 0;
};

const KNOWN_IDS = new Set(VOICE_LINES.map((l) => l.id));

export function parseVoiceState(sp: URLSearchParams): VoiceClientState {
  const played = int(sp.get("played"), 10_000);
  return {
    played,
    since: sp.has("vsince") ? int(sp.get("vsince"), 10_000) : played,
    breaks: int(sp.get("vn"), 10_000),
    seen: (sp.get("vseen") ?? "").split(",").filter((s) => KNOWN_IDS.has(s)).slice(-VOICE_CAPS.seenWindow),
    lastCheckHour: sp.has("vhr") ? int(sp.get("vhr"), 23) : null,
  };
}

export interface VoiceContext {
  hour: number;
  /** The language the listener locked to, or null for the open station. */
  language: string | null;
  state: VoiceClientState;
  timeChecks?: boolean;
}

/** A queue item as the placement rules see it: vocal tracks speak their own language, instrumentals have none. */
export interface VoiceSlotItem {
  language: string;
  type?: "ad" | "voice";
  kind?: "instrumental";
  joinedToPrev?: boolean;
}

/** Order of break kinds by how many breaks have played: greeting first, then links, a station ident every fourth. */
export const PROGRAMME_EVERY = 4;
const ROTATION: VoiceKind[] = ["ident-daypart", "host-link", "host-link", "ident-station"];

function candidates(lines: VoiceLine[], ctx: VoiceContext, lang: string, kind: VoiceKind): VoiceLine[] {
  const part = daypartOf(ctx.hour);
  return lines.filter((l) => {
    if (l.kind !== kind || l.lang !== lang || ctx.state.seen.includes(l.id)) return false;
    if (kind === "host-link" || kind === "ident-daypart" || kind === "programme") return l.daypart === part;
    if (kind === "time-check") return l.hour === ctx.hour;
    return true;
  });
}

/** One line for this slot, or null when nothing fits (wrong language, nothing unseen, no rendered lines yet). */
export function chooseLine(lines: VoiceLine[], ctx: VoiceContext, lang: string, rand: () => number = Math.random): VoiceLine | null {
  const { breaks, lastCheckHour } = ctx.state;
  const wanted: VoiceKind[] = [];
  // A time check follows the first break whenever the hour has moved on since the last one.
  if (ctx.timeChecks && breaks > 0 && lastCheckHour !== ctx.hour) wanted.push("time-check");
  // A programme (lib/station/programmes.ts) takes every PROGRAMME_EVERY-th break when lines exist; otherwise the break is a normal one.
  if (breaks % PROGRAMME_EVERY === PROGRAMME_EVERY - 1) wanted.push("programme");
  wanted.push(ROTATION[breaks % ROTATION.length]!, "host-link", "ident-daypart");
  for (const kind of wanted) {
    const pool = candidates(lines, ctx, lang, kind);
    if (pool.length > 0) return pool[Math.min(Math.floor(rand() * pool.length), pool.length - 1)]!;
  }
  return null;
}

/** The language a break at `index` would speak: the locked language, else that of the vocal track it introduces. */
function slotLanguage(items: VoiceSlotItem[], index: number, locked: string | null): string | null {
  if (locked) return locked;
  const next = items[index];
  if (!next || next.type || next.kind === "instrumental") return null;
  return next.language || null;
}

export interface VoicePlacement { line: VoiceLine; index: number }

/**
 * The one voice break (if any) for this slice of the queue. Starts at the earliest cap-allowed position and slides later past
 * slots that forbid it: inside a set, next to an ad, before an instrumental on the open station, or with no line for the language.
 */
export function pickVoice(lines: VoiceLine[], items: VoiceSlotItem[], ctx: VoiceContext, rand: () => number = Math.random): VoicePlacement | null {
  if (lines.length === 0) return null;
  const { played, since, breaks } = ctx.state;
  const need = breaks === 0 && played < VOICE_CAPS.firstAfterTracks ? VOICE_CAPS.firstAfterTracks - played : Math.max(VOICE_CAPS.everyTracks - since, 0);
  // The listener's first track starts straight away; the station never opens with a speech.
  for (let p = Math.max(need, played === 0 ? 1 : 0); p < items.length; p++) {
    const here = items[p]!;
    const prev = items[p - 1];
    if (here.joinedToPrev || here.type === "ad" || prev?.type === "ad") continue;
    const lang = slotLanguage(items, p, ctx.language);
    if (!lang) continue;
    const line = chooseLine(lines, ctx, lang, rand);
    if (line) return { line, index: p };
  }
  return null;
}

export interface VoiceItem {
  id: string;
  type: "voice";
  title: string;
  language: string;
  tags: string[];
  durationSeconds: number;
  url: string;
  voice: { lineId: string; kind: VoiceKind; text: string; aiMade: true; hour: number | null; fadeInMs: number };
}

export function voiceItem(line: VoiceLine, nonce: string): VoiceItem {
  return {
    id: `voice:${line.id}:${nonce}`,
    type: "voice",
    title: "neo-fm AI host",
    language: line.lang,
    tags: [],
    durationSeconds: line.seconds,
    url: `/voice/${line.id}.mp3`,
    voice: { lineId: line.id, kind: line.kind, text: line.text, aiMade: true, hour: line.hour ?? null, fadeInMs: 250 },
  };
}
