"use client";

/**
 * v1.4 Sprint 3: thin wrapper around `ForkSongDialog` so call sites
 * keep their existing prop shape while the dialog owns the dialog UI.
 *
 * v1.4 live-bug closeout: now forwards parent-doc defaults (tempo, key,
 * voice_id, language) so the dialog's dropdowns can render "(inherit
 * <X>)" instead of generic placeholders.
 */
import { ForkSongDialog } from "./fork-song-dialog";

export function VariationButton({
  songId,
  styleFamily,
  sections,
  variant = "primary",
  initialTempo,
  initialKey,
  initialVoiceId,
  language,
}: {
  songId: string;
  styleFamily: string;
  sections?: ReadonlyArray<{ id: string; type: string }>;
  variant?: "primary" | "subtle";
  initialTempo?: number;
  initialKey?: string;
  initialVoiceId?: string;
  language?: string;
}) {
  return (
    <ForkSongDialog
      songId={songId}
      kind="variation"
      styleFamily={styleFamily}
      sections={sections}
      variant={variant}
      initialTempo={initialTempo}
      initialKey={initialKey}
      initialVoiceId={initialVoiceId}
      language={language}
    />
  );
}
