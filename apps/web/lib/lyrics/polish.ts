import type Anthropic from "@anthropic-ai/sdk";
import { summariseAnthropicUsage, type TokenUsage } from "../cost/usage";

import { meter } from "../eval/cost";

export const POLISH_MODEL = "claude-sonnet-5-5";

/** Placeholders every polish template must contain (validated before a candidate is stored). */
export const POLISH_PLACEHOLDERS = ["{{language}}", "{{style}}", "{{brief}}", "{{lyrics}}"] as const;

/** The evaluated default (EVAL-PCE.md, batch fullB). Candidates drafted by the self-improvement loop replace this only after offline eval + human approval. */
export const DEFAULT_POLISH_TEMPLATE = `You are a senior lyricist and prosody editor in {{language}} (style family: {{style}}).
Brief: {{brief}}
Here is a draft song lyric chosen by a selection engine. Edit it minimally:
1. PROSODY: make paired lines match in syllable/akshara count and stress so they sing to one tune; fix broken rhyme/prasa/anuprasa where the style expects it.
2. DICTION: use natural spoken-poetic register for the style; fix spelling, sandhi and any translated-sounding phrasing; keep native script only.
3. FRESHNESS: replace any stock film-lyric cliche with a specific image from the brief.
Keep the section tags, the number of lines and the overall length (about 8 short lines for a 30-second song). Do not add commentary. Output ONLY the final lyrics.

--- DRAFT ---
{{lyrics}}`;

export function validatePolishTemplate(t: string): string | null {
  if (t.length < 200 || t.length > 4000) return "template length out of range";
  for (const p of POLISH_PLACEHOLDERS) if (!t.includes(p)) return `missing placeholder ${p}`;
  if (/https?:\/\//i.test(t)) return "urls are not allowed in templates";
  if (/ignore (all|any|previous)|system prompt|api[_ ]?key|disable (the )?(safety|moderation)/i.test(t)) return "template contains instruction-like or safety-related text";
  return null;
}

function fill(t: string, a: { language: string; style: string; brief: string; lyrics: string }): string {
  return t.replace("{{language}}", a.language).replace("{{style}}", a.style).replace("{{brief}}", a.brief).replace("{{lyrics}}", a.lyrics);
}

/** Meter/diction polish applied to a committed PCE lyric. Minimal edits only: sections, length and imagery stay. */
export async function polishLyrics(
  client: Anthropic,
  a: { language: string; style: string; brief: string; lyrics: string },
  template: string = DEFAULT_POLISH_TEMPLATE,
  onUsage?: (u: TokenUsage) => void,
): Promise<string> {
  const res = await client.messages.create({ model: POLISH_MODEL, max_tokens: 8000, messages: [{ role: "user", content: fill(template, a) }] });
  onUsage?.(summariseAnthropicUsage(POLISH_MODEL, res.usage));
  meter.record(POLISH_MODEL, res.usage);
  const out = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  if (out.length < 20) throw new Error(`empty polish output (stop=${res.stop_reason})`);
  return out;
}

let cache: { at: number; template: string } | null = null;
/** The live polish template (config_versions kind=polish_prompt, status=live), cached 60 s; falls back to the evaluated default. */
export async function livePolishTemplate(db: { from: (t: string) => any }): Promise<string> {
  if (cache && Date.now() - cache.at < 60_000) return cache.template;
  let template = DEFAULT_POLISH_TEMPLATE;
  try {
    const { data } = await db.from("config_versions").select("payload").eq("kind", "polish_prompt").eq("status", "live").limit(1);
    const t = ((data ?? [])[0] as { payload?: { template?: string } } | undefined)?.payload?.template;
    if (t && !validatePolishTemplate(t)) template = t;
  } catch { /* default */ }
  cache = { at: Date.now(), template };
  return template;
}
