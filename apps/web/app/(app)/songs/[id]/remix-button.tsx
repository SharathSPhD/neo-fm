"use client";

/**
 * v1.4 Sprint 3: thin wrapper around `ForkSongDialog` so callers in
 * the owner / public surfaces can keep their old imports stable. The
 * dialog owns all UI + POST logic; this file just stamps it with the
 * remix `kind`.
 */
import { ForkSongDialog } from "./fork-song-dialog";

export function RemixButton({
  songId,
  styleFamily,
  sections,
  variant = "primary",
}: {
  songId: string;
  styleFamily: string;
  sections?: ReadonlyArray<{ id: string; type: string }>;
  /**
   * `primary` lights up the accent fill (use on the song detail page where
   * remix is one of two main CTAs). `subtle` flattens it to a bordered
   * button (use on public song pages where remix sits alongside Like /
   * Follow chips).
   */
  variant?: "primary" | "subtle";
}) {
  return (
    <ForkSongDialog
      songId={songId}
      kind="remix"
      styleFamily={styleFamily}
      sections={sections}
      variant={variant}
    />
  );
}
