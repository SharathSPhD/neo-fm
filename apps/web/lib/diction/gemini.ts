import type { TokenUsage } from "../cost/usage";
import { geminiInteract, geminiQaModel } from "../gemini/interactions";
import { scoreTranscript, type DictionScore } from "./index";

/** Gemini audio understanding: transcribe the sung audio in its original script. Cheap (~1.2k tokens per clip). */
export async function transcribeSung(
  audio: Uint8Array, mimeType: string, language: string, apiKey: string, fetchImpl: typeof fetch = fetch,
  onUsage?: (u: TokenUsage) => void,
): Promise<string> {
  const r = await geminiInteract({
    apiKey, model: geminiQaModel(), fetchImpl, json: true,
    text: `This is a sung ${language} song. Transcribe exactly what is sung, in the original ${language} script, one line per sung line. Do not correct, translate or add anything. Reply as JSON {"transcript": string}.`,
    audio: { data: audio, mimeType },
  });
  onUsage?.(r.usage);
  const text = r.text;
  try { return String((JSON.parse(text) as { transcript?: unknown }).transcript ?? ""); } catch { return text; }
}

export async function auditDiction(
  lyrics: string, audio: Uint8Array, mimeType: string, language: string, apiKey: string, fetchImpl: typeof fetch = fetch,
  onUsage?: (u: TokenUsage) => void,
): Promise<DictionScore & { transcript: string }> {
  const transcript = await transcribeSung(audio, mimeType, language, apiKey, fetchImpl, onUsage);
  return { ...scoreTranscript(lyrics, transcript), transcript };
}
