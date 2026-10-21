import type Anthropic from "@anthropic-ai/sdk";
import { meter } from "../../eval/cost";

/** Studio-grade drafting (lab arm `full_opus`): the model that will polish also writes the drafts, then picks the best before the polish. */
export function studioDraftPrompt(a: { language: string; style: string; brief: string; index: number; of: number }): string {
  return `You are a professional ${a.language} lyricist writing an original song for the style family "${a.style}".
Brief: ${a.brief}

Write one complete short song (about 30 to 60 seconds sung: a pallavi/hook, one or two verses, and a closing line) entirely in ${a.language}, in its native script. Use section tags in square brackets in ${a.language} (for example [ಪಲ್ಲವಿ] or [मुखड़ा]).
Craft: natural spoken idiom over literary filler, concrete images from the brief's own world, lines a singer can breathe through, a hook that repeats. Invent no words and borrow no existing song's lines.
This is draft ${a.index} of ${a.of}; make it distinct in image and angle from the others (a different opening image and a different emotional turn).
Reply with ONLY the lyrics.`;
}

/** One Opus draft. `effort` follows the polish setting (Opus always thinks; medium keeps it short). */
export async function opusDraft(client: Anthropic, model: string, a: { language: string; style: string; brief: string; index: number; of: number }): Promise<string> {
  const res = await client.messages.create({
    model, max_tokens: 4000, messages: [{ role: "user", content: studioDraftPrompt(a) }], output_config: { effort: "medium" },
  } as Parameters<Anthropic["messages"]["create"]>[0]) as Anthropic.Message;
  meter.record(model, res.usage);
  return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}
