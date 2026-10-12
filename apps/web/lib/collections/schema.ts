/**
 * Collections (user playlists): request schemas and pure helpers.
 */
import { randomBytes } from "node:crypto";

import { z } from "zod";

export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type CollectionVisibility = (typeof VISIBILITIES)[number];

export const MAX_COLLECTIONS_PER_USER = 50;
export const MAX_ITEMS_PER_COLLECTION = 100;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export const CollectionTitleSchema = z.string().transform(collapse).pipe(z.string().min(1).max(80));
export const CollectionDescriptionSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(280));
export const VisibilitySchema = z.enum(VISIBILITIES);

export const CreateCollectionSchema = z.object({
  title: CollectionTitleSchema,
  description: CollectionDescriptionSchema.optional(),
  visibility: VisibilitySchema.default("private"),
});

export const PatchCollectionSchema = z
  .object({
    title: CollectionTitleSchema.optional(),
    description: CollectionDescriptionSchema.nullable().optional(),
    visibility: VisibilitySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });

export const AddItemSchema = z.object({ jobId: z.string().uuid() });

export const PublicIdSchema = z.string().regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** 10-char Crockford-style slug, same alphabet as song public ids. */
export function mintPublicId(bytes: Uint8Array = randomBytes(10)): string {
  let out = "";
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i]! & 31];
  return out;
}

/** Text that will be shown publicly (title + description) as one moderation input. */
export function moderationText(v: { title?: string; description?: string | null }): string {
  return [v.title, v.description].filter(Boolean).join("\n");
}

/** Whether a song may be added to someone's collection. */
export function canAddSong(
  song: { user_id: string; published_visibility: string | null },
  userId: string,
): boolean {
  return song.user_id === userId || songVisibleToPublic(song.published_visibility);
}

/** Whether a song row may be shown on a collection page to a non-owner. */
export function songVisibleToPublic(published_visibility: string | null): boolean {
  return published_visibility === "public" || published_visibility === "unlisted";
}
