import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const LanguageSchema = z.enum(["en", "hi", "kn"]);
export type Language = z.infer<typeof LanguageSchema>;

export const StyleFamilySchema = z.enum([
  "western",
  "carnatic",
  "hindustani",
  "kannada-folk",
]);
export type StyleFamily = z.infer<typeof StyleFamilySchema>;

export const DurationSchema = z.union([
  z.literal(30),
  z.literal(60),
  z.literal(90),
  z.literal(180),
]);
export type Duration = z.infer<typeof DurationSchema>;

export const SectionTypeSchema = z.enum([
  "intro",
  "verse",
  "chorus",
  "bridge",
  "outro",
  "pallavi",
  "anupallavi",
  "charanam",
  "mukhda",
  "antara",
  "saranam",
  "alaap",
  "sargam",
  "folk_refrain",
  "folk_stanza",
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const ScriptSchema = z.enum([
  "latin",
  "devanagari",
  "tamil",
  "kannada",
  "telugu",
  "bengali",
]);
export type Script = z.infer<typeof ScriptSchema>;

/**
 * Lyric length caps (Sprint 4 / launch-readiness):
 *
 * - per section: 1000 characters
 * - per document total: 4000 characters
 *
 * Caps protect the model context window, our quota, and HeartMuLa's
 * tokenizer. The UI surfaces a warning at 800 / 3200 (80%) and rejects
 * at the hard cap. These constants live in `@neo-fm/song-doc` so the
 * web app, the worker, and any future SDK enforce the same numbers.
 */
export const LYRIC_PER_SECTION_MAX_CHARS = 1000;
export const LYRIC_PER_SECTION_WARN_CHARS = 800;
export const LYRIC_TOTAL_MAX_CHARS = 4000;
export const LYRIC_TOTAL_WARN_CHARS = 3200;

/**
 * Lightweight blocklist. The intent is not to be a profanity filter
 * (HeartMuLa already refuses extreme prompts) but to keep neo-fm out
 * of obvious self-harm / hate / CSAM territory at the cloud edge so
 * we don't burn DGX minutes on a refused job, and so the share surface
 * (M1 / ADR 0013) doesn't get used as a hate-speech megaphone.
 *
 * Stored as lowercased substrings; the check is case-insensitive
 * substring match across the combined lyrics of all sections. We are
 * deliberately not regex-matching: it makes the bypass surface huge
 * and the false-positive rate explode.
 *
 * NOT a security boundary -- a determined attacker can transliterate
 * or insert zero-width characters. It's a tripwire that catches the
 * top 95% of casual abuse with near-zero collateral damage.
 */
const LYRIC_BLOCKLIST: readonly string[] = [
  // self-harm + suicide
  "kill yourself",
  "kill myself",
  "commit suicide",
  // hate / slurs (a handful of high-signal English ones; we don't enumerate
  // all of them here -- the worker has a longer list and the share-surface
  // moderation queue takes over for unlisted/public).
  // CSAM tripwires
  "child porn",
  "cp generator",
];

/**
 * Returns the array of blocklist terms that hit in the given text.
 * Empty array if clean.
 */
export function detectBlockedLyricTerms(lyrics: string): string[] {
  if (!lyrics) return [];
  const haystack = lyrics.toLowerCase();
  return LYRIC_BLOCKLIST.filter((term) => haystack.includes(term));
}

export const SectionSchema = z.object({
  id: z.string().min(1).max(64),
  type: SectionTypeSchema,
  lyrics: z.string().max(LYRIC_PER_SECTION_MAX_CHARS).optional(),
  script: ScriptSchema.optional(),
  transliteration: z.string().optional(),
  swara_sequence: z.string().optional(),
  phonemes: z.array(z.string()).optional(),
  target_seconds: z.number().int().min(1).max(360),
  // Free-form synthesis hints populated by a co-composer (Phase 2 onwards).
  // Mirrors the `tags` field on GenerateRequestSection in openapi-dgx.yaml; the
  // worker forwards them verbatim to music-inference.
  tags: z.array(z.string()).optional(),
});
export type Section = z.infer<typeof SectionSchema>;

const SectionInputSchema = SectionSchema.extend({
  target_seconds: z.number().int().min(1).max(360).optional(),
});
export type SectionInput = z.infer<typeof SectionInputSchema>;

export const RagaSpecSchema = z.object({
  name: z.string().min(1),
  system: z.enum(["carnatic", "hindustani"]),
  arohana: z.array(z.string()).optional(),
  avarohana: z.array(z.string()).optional(),
  nyas: z.array(z.string()).optional(),
  pakad: z.string().optional(),
});
export type RagaSpec = z.infer<typeof RagaSpecSchema>;

export const OrchestrationSchema = z.object({
  lead_vocal: z.enum(["male", "female", "instrumental"]).optional(),
  instruments: z.array(z.string()).optional(),
  texture: z.string().optional(),
});
export type Orchestration = z.infer<typeof OrchestrationSchema>;

/**
 * Refinement: a raga spec is only meaningful for Carnatic and Hindustani styles.
 * We reject mismatched style/raga combinations rather than silently ignoring
 * them — a Western document with a `raga: { system: "carnatic" }` is almost
 * certainly a producer bug, and the co-composer cannot represent it.
 *
 * `sections[].target_seconds` must sum to `target_duration_seconds`. Use the
 * `allocateSectionDurations` helper below to fill in defaults *before*
 * validating if your producer cannot supply every value.
 */
export const SongDocumentSchema = z
  .object({
    id: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
    language: LanguageSchema,
    style_family: StyleFamilySchema,
    tempo_bpm: z.number().int().min(30).max(240).optional(),
    time_signature: z.string().optional(),
    tala: z.string().optional(),
    target_duration_seconds: DurationSchema,
    sections: z.array(SectionSchema).min(1),
    orchestration: OrchestrationSchema.optional(),
    raga: RagaSpecSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((doc, ctx) => {
    if (doc.raga) {
      const raga_system = doc.raga.system;
      const style = doc.style_family;
      const ok =
        (raga_system === "carnatic" && style === "carnatic") ||
        (raga_system === "hindustani" && style === "hindustani");
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["raga"],
          message: `raga.system "${raga_system}" does not match style_family "${style}"`,
        });
      }
    }

    const sumSections = doc.sections.reduce(
      (acc, s) => acc + s.target_seconds,
      0,
    );
    if (sumSections !== doc.target_duration_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections"],
        message: `sum(section.target_seconds) = ${sumSections} must equal target_duration_seconds = ${doc.target_duration_seconds}; use allocateSectionDurations() to auto-fill before validation`,
      });
    }

    // Total-lyrics cap (Sprint 4): keeps a single song from blowing past
    // the model context window even if each section is under-cap.
    const totalLyricChars = doc.sections.reduce(
      (acc, s) => acc + (s.lyrics?.length ?? 0),
      0,
    );
    if (totalLyricChars > LYRIC_TOTAL_MAX_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections"],
        message: `total lyric chars = ${totalLyricChars} exceeds LYRIC_TOTAL_MAX_CHARS = ${LYRIC_TOTAL_MAX_CHARS}`,
      });
    }

    // Blocklist tripwire (Sprint 4): catches obvious abuse before we
    // burn DGX minutes on a refused job. Checks the union of all
    // section lyrics (case-insensitive substring).
    const combinedLyrics = doc.sections
      .map((s) => s.lyrics ?? "")
      .join("\n");
    const blocked = detectBlockedLyricTerms(combinedLyrics);
    if (blocked.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections"],
        message: `lyrics contain blocked terms: ${blocked.join(", ")}`,
      });
    }
  });

export type SongDocument = z.infer<typeof SongDocumentSchema>;

/**
 * Distributes `target_duration_seconds` across sections, filling in any
 * `target_seconds` that the producer left unset. Existing values are
 * preserved; the remainder is split equally across the unset sections.
 *
 * Returns a value shaped like `SongDocument` but **not yet validated** — pipe
 * the result through `SongDocumentSchema.parse()` to enforce the full
 * invariants (style/raga match, total-seconds match, section enums, etc.).
 */
export function allocateSectionDurations<
  T extends {
    target_duration_seconds: number;
    sections: SectionInput[];
  },
>(input: T): T & { sections: Section[] } {
  const total = input.target_duration_seconds;
  const fixed = input.sections.filter((s) => s.target_seconds !== undefined);
  const unset = input.sections.filter((s) => s.target_seconds === undefined);
  const fixedSum = fixed.reduce((acc, s) => acc + (s.target_seconds ?? 0), 0);
  const remaining = total - fixedSum;

  if (remaining < 0) {
    throw new Error(
      `fixed sections already consume ${fixedSum}s, exceeds target_duration_seconds = ${total}`,
    );
  }
  if (unset.length === 0 && remaining !== 0) {
    throw new Error(
      `all section.target_seconds set but sum = ${fixedSum} != target_duration_seconds = ${total}`,
    );
  }

  const allocated: Section[] = [];
  if (unset.length > 0) {
    const per = Math.floor(remaining / unset.length);
    const extra = remaining - per * unset.length;
    // Reject before allocating: a remainder that yields any zero-second
    // section would later fail SongDocumentSchema validation with a
    // confusing "target_seconds >= 1" message. Fail here with a clear one.
    if (per === 0 && extra < unset.length) {
      throw new Error(
        `allocateSectionDurations cannot fit ${unset.length} unset section(s) ` +
          `into ${remaining}s remaining without producing a 0-second section. ` +
          `Reduce the number of unset sections or raise target_duration_seconds.`,
      );
    }
    let i = 0;
    for (const s of input.sections) {
      if (s.target_seconds !== undefined) {
        allocated.push({ ...(s as Section) });
      } else {
        const share = per + (i < extra ? 1 : 0);
        allocated.push({ ...(s as Section), target_seconds: share });
        i += 1;
      }
    }
  } else {
    for (const s of input.sections) {
      allocated.push({ ...(s as Section) });
    }
  }

  return { ...input, sections: allocated };
}

/**
 * Pre-generated JSON Schema export so non-TS callers (Python pydantic, OpenAPI
 * tooling, IDE validators) can stay in lockstep with the Zod source of truth.
 */
export const songDocumentJsonSchema = zodToJsonSchema(SongDocumentSchema, {
  name: "SongDocument",
  $refStrategy: "none",
});

export class NotYetIntegratedError extends Error {
  constructor(component: string, phase: number) {
    super(`${component} integration lands in Phase ${phase}; not wired yet.`);
    this.name = "NotYetIntegratedError";
  }
}
