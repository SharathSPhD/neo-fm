/**
 * English render styles (flag `ENGLISH_STYLES=1`): the engine's catalog is Indian styles, so an English brief never got a
 * routed Lyria fragment or form notes. These seven cover pop, rock, R&B, hip-hop, country, indie folk and dance pop, written
 * from Google's Lyria prompt guidance (genre, tempo, instruments, vocal and production in plain English). No real artist
 * is named, and no wording is chosen to get around the safety screen. A plain brief with no genre word routes to nothing,
 * so today's behaviour is the floor.
 */
import { mentions } from "./genres";

export interface EnglishStyle {
  id: string;
  name: string;
  keywords: readonly string[];
  /** Section tags for the lyric, in order. */
  forms: readonly string[];
  lyricNotes: string;
  /** English fragment appended to the Lyria style prompt. */
  lyria: string;
}

export const ENGLISH_STYLES: readonly EnglishStyle[] = [
  { id: "en-pop", name: "Pop", keywords: ["pop", "dance pop", "synth pop", "summer song"], forms: ["Verse 1", "Pre-Chorus", "Chorus", "Verse 2", "Pre-Chorus", "Chorus", "Bridge", "Chorus"],
    lyricNotes: "Form: verse, pre-chorus, hook chorus; a title line that repeats. Metre: conversational four-beat lines, end rhyme on chorus. Avoid: stock moon/heart/rain trio; filler 'oh oh' lines in place of content.",
    lyria: "Contemporary pop, 100-120 bpm, punchy drums, bright synths, clean electric guitar, catchy hook chorus, polished vocal production, clear lead vocal upfront in the mix." },
  { id: "en-rock", name: "Rock", keywords: ["rock", "rock anthem", "punk", "alt rock", "guitar anthem"], forms: ["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus"],
    lyricNotes: "Form: verse, chorus, bridge; a shout-along chorus. Metre: strong four-beat lines, plain words, concrete images. Avoid: cliche 'fire' and 'chains' imagery.",
    lyria: "Driving rock, 110-140 bpm, distorted electric guitars, live drum kit, bass guitar, anthemic chorus with gang vocals, raw energetic lead vocal." },
  { id: "en-rnb", name: "R&B", keywords: ["r&b", "rnb", "r and b", "soul", "slow jam"], forms: ["Verse 1", "Pre-Chorus", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus"],
    lyricNotes: "Form: verse, pre-chorus, chorus with melismatic hook line. Metre: loose syncopated lines with room to breathe. Avoid: explicit content, 'baby' in every line.",
    lyria: "Smooth contemporary R&B, 65-90 bpm, warm electric piano, soft sub bass, finger snaps and light hi-hats, layered vocal harmonies, intimate expressive lead vocal." },
  { id: "en-hiphop", name: "Hip-hop", keywords: ["hip-hop", "hip hop", "hiphop", "rap", "rapper", "trap"], forms: ["Verse 1", "Hook", "Verse 2", "Hook", "Verse 3", "Hook"],
    lyricNotes: "Form: 12-16 bar verses and a sung hook. Metre: rhythmic spoken delivery with internal rhyme and multisyllabic end rhymes. Avoid: slurs, glorified violence, repeated 'yeah' filler.",
    lyria: "Hip-hop, 80-95 bpm boom-bap groove, crisp drums, deep bass, sampled keys, rhythmic rap vocal with clear enunciation, melodic sung hook." },
  { id: "en-country", name: "Country", keywords: ["country", "bluegrass", "honky tonk", "nashville"], forms: ["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus"],
    lyricNotes: "Form: story verses, plain-spoken chorus with the title. Metre: three-to-four beat lines, natural speech rhythm, end rhyme. Avoid: truck/beer/dirt-road checklist.",
    lyria: "Modern country, 85-110 bpm, acoustic guitar, pedal steel, fiddle, live drums, warm storytelling lead vocal with light twang, singalong chorus." },
  { id: "en-indie-folk", name: "Indie folk", keywords: ["indie folk", "folk", "singer-songwriter", "acoustic", "lullaby"], forms: ["Verse 1", "Verse 2", "Chorus", "Verse 3", "Bridge", "Chorus"],
    lyricNotes: "Form: verse-led, quiet chorus. Metre: unhurried lines, specific images from the brief. Avoid: abstract emotion words without a scene.",
    lyria: "Intimate indie folk, 70-100 bpm, fingerpicked acoustic guitar, soft piano, light percussion, gentle close-mic lead vocal with soft harmonies." },
  { id: "en-dance", name: "Dance / EDM", keywords: ["edm", "dance track", "house", "club", "dance floor"], forms: ["Verse", "Build", "Chorus", "Verse", "Build", "Chorus", "Outro"],
    lyricNotes: "Form: short verse, build, repeating chorus hook. Metre: short punchy lines suited to a four-on-the-floor beat. Avoid: long narrative verses.",
    lyria: "Uplifting dance-pop, 120-128 bpm four-on-the-floor kick, pulsing synth bass, arpeggiated synths, build and drop, bright catchy vocal hook." },
];

/** The English style a brief names, or undefined for a plain brief (no genre word). Longest keyword wins so "indie folk" beats "folk" and "dance pop" beats "pop". */
export function routeEnglishStyle(prompt: string): EnglishStyle | undefined {
  const text = prompt.toLowerCase();
  let best: { s: EnglishStyle; len: number } | undefined;
  for (const s of ENGLISH_STYLES) for (const k of s.keywords) if (mentions(text, k) && (!best || k.length > best.len)) best = { s, len: k.length };
  return best?.s;
}

export function englishStylesEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.ENGLISH_STYLES === "1";
}
