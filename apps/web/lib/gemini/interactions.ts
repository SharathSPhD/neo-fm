import { GoogleGenAI } from "@google/genai";
import type { TokenUsage } from "../cost/usage";

/** Model for audio understanding, judging and other QA calls; override with GEMINI_QA_MODEL. */
export const geminiQaModel = (): string => process.env.GEMINI_QA_MODEL ?? "gemini-3.8-flash";

export interface GeminiRequest {
  apiKey: string;
  model: string;
  /** The user turn. */
  text: string;
  system?: string;
  audio?: { data: Uint8Array; mimeType: string };
  /** Ask for a JSON object; the caller still parses and validates it. */
  json?: boolean;
  /** Continue a stored interaction instead of resending history. Needs the earlier call to have used `keep: true`. */
  previousInteractionId?: string;
  /** Keep the interaction server-side (needed for `previousInteractionId`). Off by default so listener audio and lyrics are not retained by Google. */
  keep?: boolean;
  fetchImpl?: typeof fetch;
}

export interface GeminiResult { text: string; id: string | undefined; usage: TokenUsage }

/**
 * Single entry point for server-side Gemini text/audio-understanding calls, on the Interactions API
 * (`client.interactions.create`) of the current `@google/genai` SDK. Replaces hand-rolled `generateContent` fetches.
 */
export async function geminiInteract(req: GeminiRequest): Promise<GeminiResult> {
  const client = new GoogleGenAI({
    apiKey: req.apiKey,
    ...(req.fetchImpl ? { httpOptions: { fetch: req.fetchImpl } } : {}),
  });
  const interaction = await client.interactions.create({
    model: req.model,
    input: req.audio
      ? [
          { type: "text", text: req.text },
          { type: "audio", data: Buffer.from(req.audio.data).toString("base64"), mime_type: req.audio.mimeType || "audio/mpeg" },
        ]
      : req.text,
    ...(req.system ? { system_instruction: req.system } : {}),
    ...(req.json ? { response_format: { type: "text", mime_type: "application/json" } } : {}),
    ...(req.previousInteractionId ? { previous_interaction_id: req.previousInteractionId } : {}),
    store: req.keep ?? false,
    // Callers own retry policy (tick loop, lyria attempts); the SDK's default 5xx retries would double-bill and hide failures.
  }, { maxRetries: 0 });
  const u = interaction.usage;
  return {
    text: interaction.output_text ?? "",
    id: interaction.id,
    usage: {
      model: req.model,
      in: u?.total_input_tokens ?? 0,
      out: (u?.total_output_tokens ?? 0) + (u?.total_thought_tokens ?? 0),
      cache_read: u?.total_cached_tokens ?? 0,
    },
  };
}
