/**
 * Admission check for instrumental pool tracks: a Gemini listen for sung or spoken voice. Instrumentals have no lyrics for
 * the diction gate to score, so "no vocals" is their evidence (pool_tracks.vocals_absent, migration 0100).
 */
import { geminiInteract, geminiQaModel } from "../gemini/interactions";

export interface VocalCheck { vocalsAbsent: boolean; note: string }

export function parseVocalCheck(text: string): VocalCheck {
  try {
    const j = JSON.parse(text) as { has_vocals?: unknown; note?: unknown };
    // Anything but an explicit "no vocals" fails closed.
    return { vocalsAbsent: j.has_vocals === false, note: String(j.note ?? "").slice(0, 200) };
  } catch {
    return { vocalsAbsent: false, note: "unparseable" };
  }
}

export async function checkNoVocals(audio: Uint8Array, mimeType: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<VocalCheck> {
  const r = await geminiInteract({
    apiKey, model: geminiQaModel(), fetchImpl, json: true,
    text: 'Listen to this track. Is there any human voice in it: singing, humming, choir, vocalise, chanting or spoken words? Reply as JSON {"has_vocals": boolean, "note": string}.',
    audio: { data: audio, mimeType },
  });
  return parseVocalCheck(r.text);
}
