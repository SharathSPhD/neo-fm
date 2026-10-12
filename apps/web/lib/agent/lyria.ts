/**
 * Lyria client + spend guard. Gemini is used for Lyria only (never text).
 * The API response carries no price, so spend is estimated per call from env
 * and reserved atomically (public.reserve_spend) *before* the call so the
 * GBP cap holds under concurrency.
 */
export type DurationClass = "clip" | "full";

export const LYRIA_MODEL: Record<DurationClass, string> = {
  clip: "lyria-3-clip-preview",
  full: "lyria-3.5",
};

export interface SpendGuard {
  /** Atomically reserve `amountGbp`; false when it would exceed the cap. */
  reserve(amountGbp: number): Promise<boolean>;
  /** Give back a reservation when the call failed before producing audio. */
  release(amountGbp: number): Promise<void>;
}

export interface LyriaResult {
  audio: Uint8Array;
  mimeType: string;
  model: string;
}

export function estimatedCostGbp(cls: DurationClass, env = process.env): number {
  // Conservative placeholders; set real figures from the AI Studio billing page.
  const v = cls === "clip" ? env.LYRIA_COST_GBP_CLIP : env.LYRIA_COST_GBP_FULL;
  const n = Number(v ?? (cls === "clip" ? "0.05" : "0.25"));
  return Number.isFinite(n) && n > 0 ? n : cls === "clip" ? 0.05 : 0.25;
}

export class SpendCapError extends Error {
  constructor() {
    super("Lyria spend cap reached");
    this.name = "SpendCapError";
  }
}

/**
 * Lyria 3.5 honours an explicit length instruction (measured: "exactly 60 seconds total" -> 62.7 s; without it a
 * 60 s request produced ~170 s). The clip model is fixed at ~30 s, so no instruction is added for it.
 */
export function buildPrompt(stylePrompt: string, lyrics: string, targetSeconds?: number, cls: DurationClass = "full"): string {
  const len = cls === "full" && targetSeconds && targetSeconds > 0
    ? `Duration: exactly ${Math.round(targetSeconds)} seconds total, do not exceed ${Math.round(targetSeconds)} seconds. `
    : "";
  return `${len}${stylePrompt.trim()}\n\nLyrics:\n${lyrics.trim()}`;
}

export async function generateMusic(
  args: { stylePrompt: string; lyrics: string; durationClass: DurationClass; targetSeconds?: number },
  deps: { guard: SpendGuard; apiKey: string; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<LyriaResult> {
  const f = deps.fetchImpl ?? fetch;
  const cost = estimatedCostGbp(args.durationClass, deps.env);
  if (!(await deps.guard.reserve(cost))) throw new SpendCapError();
  const model = LYRIA_MODEL[args.durationClass];
  try {
    const res = await f(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": deps.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(args.stylePrompt, args.lyrics, args.targetSeconds, args.durationClass) }] }],
          generationConfig: { responseModalities: ["AUDIO", "TEXT"] },
        }),
      },
    );
    if (!res.ok) throw new Error(`lyria ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
    };
    const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part?.inlineData) throw new Error("lyria returned no audio part");
    return {
      audio: Uint8Array.from(Buffer.from(part.inlineData.data, "base64")),
      mimeType: part.inlineData.mimeType,
      model,
    };
  } catch (e) {
    await deps.guard.release(cost);
    throw e;
  }
}
