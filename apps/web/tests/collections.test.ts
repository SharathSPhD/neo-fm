import { describe, expect, it } from "vitest";

import {
  AddItemSchema,
  canAddSong,
  CreateCollectionSchema,
  mintPublicId,
  moderationText,
  PatchCollectionSchema,
  PublicIdSchema,
  songVisibleToPublic,
} from "../lib/collections/schema";

describe("collections schema", () => {
  it("mints slugs that satisfy the public id pattern, with no ambiguous letters", () => {
    for (let i = 0; i < 200; i++) {
      const id = mintPublicId();
      expect(PublicIdSchema.safeParse(id).success).toBe(true);
      expect(id).not.toMatch(/[ilou]/);
    }
  });

  it("is deterministic for given bytes and spans the alphabet", () => {
    expect(mintPublicId(new Uint8Array(10))).toBe("0000000000");
    expect(mintPublicId(new Uint8Array(10).fill(31))).toBe("zzzzzzzzzz");
  });

  it("normalises titles and defaults to private", () => {
    const v = CreateCollectionSchema.parse({ title: "  मेरे   भजन \n" });
    expect(v.title).toBe("मेरे भजन");
    expect(v.visibility).toBe("private");
  });

  it("rejects empty, overlong and unknown-visibility input", () => {
    expect(CreateCollectionSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(CreateCollectionSchema.safeParse({ title: "x".repeat(81) }).success).toBe(false);
    expect(CreateCollectionSchema.safeParse({ title: "ok", visibility: "everyone" }).success).toBe(false);
    expect(CreateCollectionSchema.safeParse({ title: "ok", description: "d".repeat(281) }).success).toBe(false);
  });

  it("requires at least one field in a patch and allows clearing the description", () => {
    expect(PatchCollectionSchema.safeParse({}).success).toBe(false);
    expect(PatchCollectionSchema.parse({ description: null }).description).toBeNull();
  });

  it("only accepts uuids as song ids", () => {
    expect(AddItemSchema.safeParse({ jobId: "nope" }).success).toBe(false);
    expect(AddItemSchema.safeParse({ jobId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });

  it("joins the public text for moderation", () => {
    expect(moderationText({ title: "A", description: "B" })).toBe("A\nB");
    expect(moderationText({ title: "A", description: null })).toBe("A");
  });
});

describe("song eligibility", () => {
  it("lets you add your own songs of any visibility", () => {
    expect(canAddSong({ user_id: "u1", published_visibility: "private" }, "u1")).toBe(true);
    expect(canAddSong({ user_id: "u1", published_visibility: null }, "u1")).toBe(true);
  });

  it("lets you add others' songs only when published", () => {
    expect(canAddSong({ user_id: "u2", published_visibility: "public" }, "u1")).toBe(true);
    expect(canAddSong({ user_id: "u2", published_visibility: "unlisted" }, "u1")).toBe(true);
    expect(canAddSong({ user_id: "u2", published_visibility: "private" }, "u1")).toBe(false);
    expect(canAddSong({ user_id: "u2", published_visibility: null }, "u1")).toBe(false);
  });

  it("shows only published songs to strangers", () => {
    expect(songVisibleToPublic("public")).toBe(true);
    expect(songVisibleToPublic("unlisted")).toBe(true);
    expect(songVisibleToPublic("private")).toBe(false);
    expect(songVisibleToPublic(null)).toBe(false);
  });
});
