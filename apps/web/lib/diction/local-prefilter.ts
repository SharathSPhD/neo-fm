/**
 * Free local sung-diction pre-filter (IndicConformer kn/hi), OFF unless DICTION_LOCAL_PREFILTER=1 and LOCAL_ASR_URL is set.
 * Advisory only: it never replaces the Gemini transcript for gating or arm ranking (open Whisper ranked arms backwards,
 * tools/lyrics-lab/results/audio/local_diction.md). Use it to order the Gemini queue, tag unscored lake tracks and add a
 * column to /admin/quality. The service takes {audio_url, language} and returns {transcript}; it is the 5090 job from
 * tools/lyrics-lab/audio/indicconformer_diction.py behind a small HTTP wrapper. Fails closed to null: a missing or broken
 * service must never block a render or a page.
 */
import { safeEmbedUrl } from "../agent/embed-url";
import { gateTranscript } from "./gate";

export const LOCAL_PREFILTER_LANGUAGES = ["kn", "hi"] as const;
/** Below this order-free match a local read is "likely poor": worth a Gemini check first or a lake look. Starting point until the correlation check passes. */
export const LOCAL_LOW_PCT = 50;

export interface LocalDiction { unorderedPct: number; source: "local-asr"; lowLikely: boolean }

export function localPrefilterEnabled(language: string, env = process.env): boolean {
  return env.DICTION_LOCAL_PREFILTER === "1" && !!safeEmbedUrl(env.LOCAL_ASR_URL) && (LOCAL_PREFILTER_LANGUAGES as readonly string[]).includes(language);
}

/** Score an already-obtained local transcript with the production gate. */
export function scoreLocal(lyrics: string, transcript: string): LocalDiction {
  const g = gateTranscript(lyrics, transcript);
  return { unorderedPct: g.unorderedPct, source: "local-asr", lowLikely: g.unorderedPct < LOCAL_LOW_PCT };
}

export async function localPrefilter(
  args: { lyrics: string; language: string; audioUrl: string },
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LocalDiction | null> {
  const env = deps.env ?? process.env;
  if (!localPrefilterEnabled(args.language, env)) return null;
  const base = safeEmbedUrl(env.LOCAL_ASR_URL)!;
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${base}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.LOCAL_ASR_TOKEN ? { authorization: `Bearer ${env.LOCAL_ASR_TOKEN}` } : {}) },
      body: JSON.stringify({ audio_url: args.audioUrl, language: args.language }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 60_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { transcript?: unknown };
    return typeof j.transcript === "string" && j.transcript.trim() ? scoreLocal(args.lyrics, j.transcript) : null;
  } catch {
    return null;
  }
}
