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

export const SectionSchema = z.object({
  id: z.string().min(1),
  type: SectionTypeSchema,
  lyrics: z.string().optional(),
  script: ScriptSchema.optional(),
  transliteration: z.string().optional(),
  swara_sequence: z.string().optional(),
  phonemes: z.array(z.string()).optional(),
  target_seconds: z.number().int().min(1).max(360),
});
export type Section = z.infer<typeof SectionSchema>;

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
 * We accept it on a Western or folk document but log it as "ignored" downstream.
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
  });

export type SongDocument = z.infer<typeof SongDocumentSchema>;

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
