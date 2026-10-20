import type { TokenUsage } from "../cost/usage";
import { geminiInteract, geminiQaModel } from "../gemini/interactions";
import type { VoiceChoice } from "./index";

export type HeardGender = "male" | "female" | "mixed" | "child" | "unclear";

const HEARD: readonly HeardGender[] = ["male", "female", "mixed", "child", "unclear"];

/** Gemini listen: who leads the vocal. One cheap audio call; any failure surfaces to the caller. */
export async function judgeLeadGender(
  audio: Uint8Array, mimeType: string, apiKey: string, fetchImpl: typeof fetch = fetch, onUsage?: (u: TokenUsage) => void,
): Promise<HeardGender> {
  const r = await geminiInteract({
    apiKey, model: geminiQaModel(), fetchImpl, json: true,
    text: 'Listen to this sung track. Who sings the lead vocal? Reply as JSON {"lead_gender":"male"|"female"|"mixed"|"child"|"unclear"}. Use "mixed" when a male and a female voice share the lead.',
    audio: { data: audio, mimeType },
  });
  onUsage?.(r.usage);
  try {
    const g = (JSON.parse(r.text) as { lead_gender?: unknown }).lead_gender;
    return HEARD.includes(g as HeardGender) ? (g as HeardGender) : "unclear";
  } catch { return "unclear"; }
}

/** A miss is a clearly different voice than asked for; "unclear" gets the benefit of the doubt so we never re-render on noise. */
export function genderMissed(choice: VoiceChoice, heard: HeardGender): boolean {
  if (heard === "unclear" || choice === "station") return false;
  if (choice === "duet") return heard !== "mixed";
  return heard !== choice;
}

/**
 * Renders once; when the listener chose a voice and the check hears another, renders once more and keeps the retry.
 * The retry is a second Lyria spend through the same guard, so a spend-cap or render error returns the first render.
 * Check failures never block a song.
 */
export async function renderWithVoiceCheck<R extends { audio: Uint8Array; mimeType: string }>(
  choice: VoiceChoice,
  render: () => Promise<R>,
  check: (r: R) => Promise<HeardGender>,
): Promise<{ result: R; missed: boolean; retried: boolean }> {
  const first = await render();
  if (choice === "station") return { result: first, missed: false, retried: false };
  let heard: HeardGender;
  try { heard = await check(first); } catch { return { result: first, missed: false, retried: false }; }
  if (!genderMissed(choice, heard)) return { result: first, missed: false, retried: false };
  try { return { result: await render(), missed: true, retried: true }; } catch { return { result: first, missed: true, retried: false }; }
}
