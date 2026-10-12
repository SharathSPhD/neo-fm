import { DEFAULT_POLISH_TEMPLATE } from "./polish";

/**
 * Offline prosody experiments (docs/experiments/kannada-prosody.md). These are candidate polish templates for the
 * eval harness only: nothing here is read by the product path, `livePolishTemplate` or the self-improve promotion
 * path. A variant ships only through the existing gate (both judge families, no dimension worse by > 0.15) and S's approval.
 */
export interface PolishVariant { id: string; hypothesis: string; template: string }

const TAIL = `Keep the section tags, the number of lines and the overall length (about 8 short lines for a 30-second song). Do not add commentary. Output ONLY the final lyrics.

--- DRAFT ---
{{lyrics}}`;

const HEAD = `You are a senior lyricist and prosody editor in {{language}} (style family: {{style}}).
Brief: {{brief}}
Here is a draft song lyric chosen by a selection engine. Edit it minimally.`;

export const POLISH_VARIANTS: readonly PolishVariant[] = [
  {
    id: "kn-laghu-guru",
    hypothesis: "Naming the unit of measure (laghu/guru matras, not raw syllables) and the Kannada line-end conventions lets the editor equalise paired lines in the unit that is actually sung.",
    template: `${HEAD}
1. METER: for each pair of lines that sing to one tune, count matras (laghu = 1, guru = 2; a long vowel or a vowel before a conjunct is guru) and make the two lines equal within one matra. Prefer cutting or swapping a word over padding with fillers.
2. LINE ENDS: pairs should end on the same vowel family; keep any dvitiyakshara prasa (second-syllable rhyme) the draft already has, and repair it where it is almost there.
3. DICTION: natural spoken-poetic register for the style, correct spelling and sandhi, native script only, no translated-sounding phrasing.
${TAIL}`,
  },
  {
    id: "anchor-pair",
    hypothesis: "Treating the first line of each pair as the fixed anchor and editing only the second line limits damage to imagery while still fixing the mismatch, which the broader rewrites traded away.",
    template: `${HEAD}
1. In every pair of lines (1-2, 3-4, ...) line one is the ANCHOR: do not change it unless it is ungrammatical. Edit line two so it has the same rhythm, syllable count and stress shape as its anchor and ends on a matching sound.
2. Keep every image from the draft; change word choice and order, not meaning.
3. Fix spelling and sandhi; native script only.
${TAIL}`,
  },
  {
    id: "sing-it-check",
    hypothesis: "Asking the editor to silently tap each line against a steady beat and to change only lines that fall off it focuses edits on the real prosody faults, rather than rewriting lines that already scan.",
    template: `${HEAD}
1. Silently read each line aloud against a steady beat. Change a line only if it clearly falls off the beat set by its neighbour (extra or missing syllables, a stress on the wrong syllable, a word that cannot be sung to the tune). Lines that scan must stay byte-for-byte unchanged.
2. For lines you do change, keep the image and make the smallest edit that restores the beat.
3. Native script only; fix spelling and sandhi.
${TAIL}`,
  },
];

export function polishVariant(id: string | null | undefined): PolishVariant | null {
  if (!id) return null;
  return POLISH_VARIANTS.find((v) => v.id === id) ?? null;
}

/** For tests and docs: the control every variant is compared against. */
export const CONTROL_TEMPLATE = DEFAULT_POLISH_TEMPLATE;
