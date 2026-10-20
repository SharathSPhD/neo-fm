/**
 * Zod request schemas for /api/songs, mirroring the contract in
 * docs/contracts/openapi-cloud.yaml. The Song Document branch reuses
 * `SongDocumentSchema` from `@neo-fm/song-doc` so there is exactly one
 * source of truth.
 */
import {
  DurationSchema,
  LanguageSchema,
  SongDocumentSchema,
  StyleFamilySchema,
} from "@neo-fm/song-doc";
import { z } from "zod";

import { VOICE_CHOICES, VOICE_STYLES } from "../voice";
import { isEnabledLanguage } from "../languages/registry";

export const CreateSongRequestSchema = z
  .object({
    song_document: SongDocumentSchema.optional(),
    prompt: z.string().trim().min(1).optional(),
    language: LanguageSchema.optional(),
    style_family: StyleFamilySchema.optional(),
    target_duration_seconds: DurationSchema.optional(),
    /** Job this song is a new-language version of (prompt branch only). */
    version_of: z.string().uuid().optional(),
    /** /gift only: spend a gift-pack credit once the monthly quota is used up. */
    use_pack: z.boolean().optional(),
    /** Lead-voice choice (lib/voice). Clamped to the tier at render time; ignored unless VOICE_CHOICE=1. */
    voice: z.object({ choice: z.enum(VOICE_CHOICES), style: z.enum(VOICE_STYLES).optional() }).optional(),
  })
  .superRefine((value, ctx) => {
    const has_doc = !!value.song_document;
    const has_prompt = !!value.prompt;
    if (has_doc === has_prompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "exactly one of song_document or prompt must be provided",
        path: [],
      });
      return;
    }
    if (value.version_of && !has_prompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "version_of requires the prompt branch",
        path: ["version_of"],
      });
    }
    if (
      has_prompt &&
      !(value.language && value.style_family && value.target_duration_seconds)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "prompt branch requires language, style_family, and target_duration_seconds",
        path: [],
      });
    }
    // Expansion languages exist in the Zod enum before the Postgres enum has them; reject until the wave is on.
    const lang = value.language ?? value.song_document?.language;
    if (lang && !isEnabledLanguage(lang, process.env.LANG_WAVES)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "language is not available yet",
        path: [value.language ? "language" : "song_document"],
      });
    }
  });
export type CreateSongRequest = z.infer<typeof CreateSongRequestSchema>;

export const ListSongsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type ListSongsQuery = z.infer<typeof ListSongsQuerySchema>;

export const SongIdSchema = z.string().uuid();
