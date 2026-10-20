/**
 * Writes one listener signal. supabase-js reports a failed insert as `{ error }` instead of throwing, so the old
 * try/catch in the route swallowed every failure (missing grant, bad uuid, dropped table) and the log stayed empty
 * with nothing to say why. This returns whether the row landed so the route can log the failure.
 */
import type { SignalInput } from "./signals";

export interface SignalInsertClient {
  from(table: string): { insert(row: object): PromiseLike<{ error: { message: string; code?: string } | null }> };
}

export async function insertSignal(
  client: SignalInsertClient,
  userId: string,
  sig: SignalInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const row = { user_id: userId, track_id: sig.trackId, kind: sig.kind, position_ms: sig.positionMs };
    let { error } = await client
      .from("station_signals")
      .insert(sig.setId ? { ...row, set_id: sig.setId, set_index: sig.setIndex } : row);
    // Migration 0107 (set_id, set_index) not applied yet: store the plain signal rather than lose it.
    if (error && sig.setId && (error.code === "42703" || error.code === "PGRST204")) {
      ({ error } = await client.from("station_signals").insert(row));
    }
    return error ? { ok: false, reason: error.code ?? error.message } : { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "insert threw" };
  }
}
