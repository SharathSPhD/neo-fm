import type { StationSignal, StationSignalKind } from "./rank";

export const SIGNAL_KINDS: readonly StationSignalKind[] = ["play", "like", "skip", "replay", "share", "finish"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SignalInput {
  trackId: string;
  kind: StationSignalKind;
  positionMs: number | null;
}

/** Validates an untrusted request body; returns null when it is not a well-formed signal. */
export function parseSignal(body: unknown): SignalInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.trackId !== "string" || !UUID_RE.test(b.trackId)) return null;
  if (typeof b.kind !== "string" || !SIGNAL_KINDS.includes(b.kind as StationSignalKind)) return null;
  let positionMs: number | null = null;
  if (b.positionMs !== undefined && b.positionMs !== null) {
    if (typeof b.positionMs !== "number" || !Number.isFinite(b.positionMs) || b.positionMs < 0) return null;
    positionMs = Math.min(Math.round(b.positionMs), 3_600_000);
  }
  return { trackId: b.trackId, kind: b.kind as StationSignalKind, positionMs };
}

export interface SignalRow {
  track_id: string;
  kind: string;
  created_at: string;
}

export function rowsToSignals(rows: SignalRow[], now = Date.now()): StationSignal[] {
  return rows
    .filter((r) => SIGNAL_KINDS.includes(r.kind as StationSignalKind))
    .map((r) => ({ trackId: r.track_id, kind: r.kind as StationSignalKind, ageMs: now - Date.parse(r.created_at) }));
}
