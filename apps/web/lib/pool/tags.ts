/**
 * Tags and the admission rule for the station pool (public.pool_tracks, migration 0092).
 * Pure functions: the ingest route and the seed script both go through here so the rule lives in one place.
 */
import type { DictionVerdict } from "../diction/gate";

/** "zxx" (ISO 639-2, no linguistic content) marks an instrumental: one render serves every listener. */
export const POOL_LANGUAGES = ["hi", "ta", "te", "kn", "bn", "en", "sa", "hinglish", "zxx", "mr", "pa", "gu", "ml", "bho", "or", "ur", "as"] as const;
export type PoolLanguage = (typeof POOL_LANGUAGES)[number];

/** Closed vocabularies keep station ranking joins cheap; anything outside is dropped, not stored. */
export const POOL_MOODS = ["devotional", "joyful", "nostalgic", "romantic", "festive", "calm", "energetic", "melancholic", "celebratory", "playful"] as const;
export const POOL_THEMES = [
  "diwali", "wedding", "anniversary", "birthday", "mother", "rakhi", "farewell", "new-year", "harvest", "monsoon",
  "bhakti", "friendship", "travel", "village", "love", "spring",
] as const;

export interface PoolTags {
  language: PoolLanguage;
  genre: string | null;
  raga: string | null;
  mood: string[];
  theme: string[];
  tempo_bpm: number | null;
}

const LANG_BY_NAME: Record<string, PoolLanguage> = { hindi: "hi", tamil: "ta", telugu: "te", kannada: "kn", bengali: "bn", english: "en", sanskrit: "sa", marathi: "mr", punjabi: "pa", gujarati: "gu", malayalam: "ml", bhojpuri: "bho", odia: "or", oriya: "or", urdu: "ur", assamese: "as" };

export function normalizeLanguage(v: string): PoolLanguage | null {
  const s = v.trim().toLowerCase();
  if ((POOL_LANGUAGES as readonly string[]).includes(s)) return s as PoolLanguage;
  return LANG_BY_NAME[s] ?? null;
}

/** Keep only values in the closed vocabulary, de-duplicated, order preserved. */
export function pickVocab(values: readonly string[], vocab: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = v.trim().toLowerCase();
    if (vocab.includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

interface DocLike {
  language?: string;
  style_family?: string;
  tempo_bpm?: number;
  metadata?: { prompt?: string };
  sections?: Array<{ tags?: string[] }>;
}

const MOOD_HINTS: Array<[RegExp, string]> = [
  [/devotion|bhakti|prayer|keerthana|shloka|\bgod\b|temple/i, "devotional"],
  [/nostalg|old |memor|never sent|miss/i, "nostalgic"],
  [/love|romanc|anniversary|wedding/i, "romantic"],
  [/festiv|diwali|deepavali|sankranti|pongal|ugadi|boishakh|navratri/i, "festive"],
  [/celebrat|wedding|birthday/i, "celebratory"],
  [/rain|monsoon|calm|lullaby|peace/i, "calm"],
  [/farewell|goodbye|sad|lonely/i, "melancholic"],
  [/dance|upbeat|fast|folk/i, "energetic"],
  [/happy|joy|fun/i, "joyful"],
];
const THEME_HINTS: Array<[RegExp, string]> = [
  [/diwali|deepavali/i, "diwali"],
  [/wedding|vivah|shaadi/i, "wedding"],
  [/anniversary/i, "anniversary"],
  [/birthday/i, "birthday"],
  [/\bamma\b|mother|\bmaa\b|mom/i, "mother"],
  [/rakhi|raksha bandhan/i, "rakhi"],
  [/farewell|goodbye|retire/i, "farewell"],
  [/new year|ugadi|boishakh|vishu|puthandu/i, "new-year"],
  [/sankranti|pongal|harvest|paddy|onam/i, "harvest"],
  [/monsoon|rain/i, "monsoon"],
  [/devotion|bhakti|keerthana|shloka|temple|\bram\b|krishna/i, "bhakti"],
  [/friend/i, "friendship"],
  [/train|journey|travel|bus/i, "travel"],
  [/village|\bgaon\b|\bgaanv\b/i, "village"],
  [/love|romanc/i, "love"],
  [/spring|vasant/i, "spring"],
];

/** Tags from a stored SongDocument (prod jobs). Mood and theme are inferred from the prompt and style only. */
export function tagsFromDocument(doc: DocLike): PoolTags | null {
  const language = normalizeLanguage(doc.language ?? "");
  if (!language) return null;
  const tagList = (doc.sections ?? []).flatMap((s) => s.tags ?? []);
  const find = (prefix: string) => tagList.find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null;
  const genre = find("genre:") ?? doc.style_family ?? null;
  const raga = find("raga:");
  const text = `${doc.metadata?.prompt ?? ""} ${doc.style_family ?? ""}`;
  const hit = (hints: Array<[RegExp, string]>) => [...new Set(hints.filter(([re]) => re.test(text)).map(([, v]) => v))];
  const bpm = typeof doc.tempo_bpm === "number" && doc.tempo_bpm >= 40 && doc.tempo_bpm <= 220 ? Math.round(doc.tempo_bpm) : null;
  return {
    language, genre, raga,
    mood: pickVocab(hit(MOOD_HINTS), POOL_MOODS),
    theme: pickVocab(hit(THEME_HINTS), POOL_THEMES),
    tempo_bpm: bpm,
  };
}

export interface PoolQa { unorderedPct: number | null; verdict: DictionVerdict | null }

/** The admission rule, mirrored by the CHECK constraint in 0092: order-free U >= 80 and verdict pass. */
export function passesAdmission(qa: PoolQa): boolean {
  return qa.verdict === "pass" && qa.unorderedPct !== null && qa.unorderedPct >= 80;
}

/** The instrumental admission rule, mirrored by the CHECK constraint in 0100: the audio check found no voice. */
export function passesInstrumentalAdmission(vocalsAbsent: boolean | null): boolean {
  return vocalsAbsent === true;
}
