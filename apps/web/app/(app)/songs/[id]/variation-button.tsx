"use client";

/**
 * v1.4 Sprint 3: thin wrapper around `ForkSongDialog` so call sites
 * keep their existing prop shape while the dialog owns the dialog UI.
 */
import { ForkSongDialog } from "./fork-song-dialog";

export function VariationButton({
  songId,
  styleFamily,
  sections,
  variant = "primary",
}: {
  songId: string;
  styleFamily: string;
  sections?: ReadonlyArray<{ id: string; type: string }>;
  variant?: "primary" | "subtle";
}) {
  return (
    <ForkSongDialog
      songId={songId}
      kind="variation"
      styleFamily={styleFamily}
      sections={sections}
      variant={variant}
    />
  );
}
