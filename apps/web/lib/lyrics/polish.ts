import type Anthropic from "@anthropic-ai/sdk";
import { summariseAnthropicUsage, type TokenUsage } from "../cost/usage";

import { meter } from "../eval/cost";

export const POLISH_MODEL = "claude-sonnet-5-5";
/** Premium-lyrics candidate (lab arms only; not used by prod polish). */
export const OPUS_POLISH_MODEL = "claude-opus-5-5";

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
  model: string = POLISH_MODEL,
): Promise<string> {
  // Opus 5.5 always thinks (default effort medium): pin it so a premium-polish run is reproducible.
  const effort = model === OPUS_POLISH_MODEL ? { output_config: { effort: "medium" } } : {};
  const res = await client.messages.create({ model, max_tokens: 8000, messages: [{ role: "user", content: fill(template, a) }], ...effort } as Parameters<Anthropic["messages"]["create"]>[0]) as Anthropic.Message;
  onUsage?.(summariseAnthropicUsage(model, res.usage));
  meter.record(model, res.usage);
  const out = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  if (out.length < 20) throw new Error(`empty polish output (stop=${res.stop_reason})`);
  return out;
}

/** The non-empty lines of a lyric, in order; edit-list polish numbers and replaces these. */
const lyricLines = (lyrics: string): string[] => lyrics.split("\n").map((l) => l.trim()).filter(Boolean);

export interface LineEdit { line: number; text: string }

/** Edits from a model reply: a JSON array of {line, text}, tolerating a code fence; null when the reply is not that shape. */
export function parseLineEdits(raw: string): LineEdit[] | null {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: LineEdit[] = [];
    for (const e of arr) {
      const o = e as { line?: unknown; text?: unknown };
      if (typeof o?.line !== "number" || !Number.isInteger(o.line) || typeof o.text !== "string") return null;
      out.push({ line: o.line, text: o.text });
    }
    return out;
  } catch { return null; }
}

/** Applies single-line replacements to the numbered (1-based) non-empty lines. Section tags and multi-line or empty replacements are never edited. */
export function applyLineEdits(lyrics: string, edits: LineEdit[]): string {
  const lines = lyricLines(lyrics);
  for (const e of edits) {
    const i = e.line - 1;
    const t = e.text.trim();
    if (i < 0 || i >= lines.length || !t || t.includes("\n") || /^\[.*\]$/.test(lines[i]!)) continue;
    lines[i] = t;
  }
  return lines.join("\n");
}

const EDIT_FORMAT = `OUTPUT FORMAT (overrides "Output ONLY the final lyrics"): do not rewrite the lyric. The draft below has numbered lines. Output ONLY a JSON array of the lines you change, e.g. [{"line":3,"text":"new line 3"}]. Replace whole lines one for one; never touch section tags, never merge or split lines. Output [] if nothing needs changing.`;

/** Edit-list polish (PCE_POLISH_EDITS): same editing instructions as polishLyrics, but the model returns only the changed lines, so output tokens (most of the cost and latency) fall. Falls back to the full polish if the reply cannot be parsed. */
export async function polishLyricsEdits(
  client: Anthropic,
  a: { language: string; style: string; brief: string; lyrics: string },
  template: string = DEFAULT_POLISH_TEMPLATE,
  onUsage?: (u: TokenUsage) => void,
): Promise<string> {
  const numbered = lyricLines(a.lyrics).map((l, i) => `${i + 1}: ${l}`).join("\n");
  const prompt = `${fill(template, { ...a, lyrics: numbered })}\n\n${EDIT_FORMAT}`;
  const res = await client.messages.create({ model: POLISH_MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] });
  onUsage?.(summariseAnthropicUsage(POLISH_MODEL, res.usage));
  meter.record(POLISH_MODEL, res.usage);
  const edits = parseLineEdits(res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""));
  if (!edits) return polishLyrics(client, a, template, onUsage);
  return applyLineEdits(a.lyrics, edits);
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
