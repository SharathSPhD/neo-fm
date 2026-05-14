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

export const CreateSongRequestSchema = z
  .object({
    song_document: SongDocumentSchema.optional(),
    prompt: z.string().min(1).optional(),
    language: LanguageSchema.optional(),
    style_family: StyleFamilySchema.optional(),
    target_duration_seconds: DurationSchema.optional(),
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
  });
export type CreateSongRequest = z.infer<typeof CreateSongRequestSchema>;

export const ListSongsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type ListSongsQuery = z.infer<typeof ListSongsQuerySchema>;

export const SongIdSchema = z.string().uuid();
