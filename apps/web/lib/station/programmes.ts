/**
 * Spoken programmes: longer evergreen items than a host link ("the sound of the hour": a raga or style note, what the
 * station is). Text is ours, never scraped news (strategy/spoken-programmes.md). They ride the voice-link machinery
 * (same cadence, placement and player handling) and only exist when STATION_PROGRAMMES=1 and a line has been rendered.
 */
import raw from "./voice-programmes.json";
import type { VoiceLine } from "./voice-links";

export type ProgrammeLine = VoiceLine & { kind: "programme"; rendered: boolean };

const PROGRAMMES = raw as ProgrammeLine[];

export function programmesEnabled(): boolean {
  return process.env.STATION_PROGRAMMES === "1";
}

/** Lines the queue may use: none unless the flag is on, and only those whose audio has been rendered and ingested. */
export function programmeLines(enabled: boolean = programmesEnabled()): VoiceLine[] {
  return enabled ? PROGRAMMES.filter((l) => l.rendered && l.seconds > 0) : [];
}
