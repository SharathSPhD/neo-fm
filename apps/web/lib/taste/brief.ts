/**
 * Taste brief: what the listener tells us about their taste when they make a song, beyond the free-text prompt.
 *
 * Stored per song as structured JSON in `song_documents.document_json.metadata.taste` (no migration), so the RL and
 * taste-tuning work can read it next to the song's feedback events. Every field is a closed vocabulary except
 * `background`, a short free-text line that is moderated like the prompt. Off unless TASTE_BRIEF=1.
 *
 * Artist names are deliberately not a field: the rights screen refuses imitation, so taste is described by genre,
 * mood, instruments and era instead.
 */
import { LanguageSchema } from "@neo-fm/song-doc";
import { z } from "zod";

export const TASTE_GENRES = [
  // Western
  "pop", "rock", "indie folk", "hip-hop", "r&b", "country", "electronic", "jazz", "lo-fi", "ballad", "gospel",
  // Indian
  "carnatic", "hindustani", "film melody", "folk", "devotional", "ghazal", "sufi", "bhavageete", "rabindrasangeet",
] as const;

export const TASTE_MOODS = [
  "joyful", "romantic", "wistful", "calm", "energetic", "devotional", "playful", "melancholic", "hopeful", "nostalgic",
] as const;

/** Includes the traditional Indian instruments the render prompt can name (Carnatic, Hindustani and folk). */
export const TASTE_INSTRUMENTS = [
  "acoustic guitar", "piano", "strings", "synth", "drums", "bass",
  "veena", "violin", "mridangam", "ghatam", "flute", "nadaswaram",
  "sitar", "sarod", "santoor", "tabla", "harmonium", "dholak",
] as const;

export const TASTE_ERAS = ["classic", "70s-80s", "90s", "2000s", "modern"] as const;
export const TASTE_SETTINGS = ["city", "village", "diaspora"] as const;
export const TASTE_REGISTERS = ["formal", "colloquial"] as const;
export const TASTE_DAYPARTS = ["morning", "afternoon", "evening", "night"] as const;
export const TASTE_ENERGY = ["calm", "medium", "high"] as const;

export const BACKGROUND_MAX_CHARS = 200;
const MAX_PICKS = 4;

const pick = <T extends readonly [string, ...string[]]>(vocab: T) => z.array(z.enum(vocab)).max(MAX_PICKS).optional();

export const TasteBriefSchema = z.object({
  v: z.literal(1).default(1),
  genres: pick(TASTE_GENRES),
  moods: pick(TASTE_MOODS),
  instruments: pick(TASTE_INSTRUMENTS),
  eras: pick(TASTE_ERAS),
  energy: z.enum(TASTE_ENERGY).optional(),
  /** Languages they listen in (song-doc codes). Stored for the per-user tuning; the song's own language is set separately. */
  languages: z.array(LanguageSchema).max(MAX_PICKS).optional(),
  /** Lyric register they prefer. */
  register: z.enum(TASTE_REGISTERS).optional(),
  /** City, village or diaspora background, for imagery. */
  setting: z.enum(TASTE_SETTINGS).optional(),
  /** Mood they want at each time of day (onboarding form; the station reads it). */
  daypart_moods: z.record(z.enum(TASTE_DAYPARTS), z.enum(TASTE_MOODS)).optional(),
  /** Where they grew up, what they listen to, who the song is for: one or two sentences. */
  background: z.string().trim().max(BACKGROUND_MAX_CHARS).optional(),
});
export type TasteBrief = z.infer<typeof TasteBriefSchema>;

export function tasteBriefEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TASTE_BRIEF === "1";
}

/** Dedupes and drops empties so the stored shape is stable; null when nothing was chosen. */
export function normaliseTaste(input: unknown): TasteBrief | null {
  const parsed = TasteBriefSchema.safeParse(input);
  if (!parsed.success) return null;
  const t = parsed.data;
  const uniq = <T extends string>(xs: readonly T[] | undefined) => (xs && xs.length ? Array.from(new Set(xs)) : undefined);
  const out: TasteBrief = {
    v: 1,
    genres: uniq(t.genres),
    moods: uniq(t.moods),
    instruments: uniq(t.instruments),
    eras: uniq(t.eras),
    languages: uniq(t.languages),
    register: t.register,
    setting: t.setting,
    daypart_moods: t.daypart_moods && Object.keys(t.daypart_moods).length ? t.daypart_moods : undefined,
    energy: t.energy,
    background: t.background || undefined,
  };
  const { v: _v, ...rest } = out;
  const empty = Object.values(rest).every((x) => x === undefined);
  return empty ? null : out;
}

/** Reads a brief back from stored document metadata, tolerating anything an older or hand-edited row holds. */
export function tasteFromMetadata(metadata: unknown): TasteBrief | null {
  return normaliseTaste((metadata as { taste?: unknown } | null | undefined)?.taste);
}

const list = (xs: readonly string[] | undefined) => (xs && xs.length ? xs.join(", ") : "");

/** Block appended to the lyric brief. The explicit prompt stays in charge; taste only breaks ties. */
export function tasteBriefText(t: TasteBrief): string {
  const rows = [
    ["Genres", list(t.genres)],
    ["Moods", list(t.moods)],
    ["Eras", list(t.eras)],
    ["Energy", t.energy ?? ""],
    ["Lyric register", t.register ?? ""],
    ["Imagery from", t.setting ?? ""],
    ["Listener background", t.background ?? ""],
  ].filter(([, v]) => v);
  if (!rows.length) return "";
  return `Listener taste (chosen by the listener for this song; the brief above wins any conflict):\n${rows.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
}

/** Short phrase for the music render's style prompt: sound only, never lyrics or background text. */
export function tasteStyleHint(t: TasteBrief): string {
  const parts = [
    t.genres?.length ? `${list(t.genres)} feel` : "",
    t.instruments?.length ? `featuring ${list(t.instruments)}` : "",
    t.eras?.length ? `${list(t.eras)} production` : "",
    t.energy ? `${t.energy} energy` : "",
    t.moods?.length ? `${list(t.moods)} mood` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

/** Everything free-text in the brief, for the safety screen. */
export function tasteScreenText(t: TasteBrief): string {
  return t.background ?? "";
}
