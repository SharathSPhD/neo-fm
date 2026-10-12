import type Anthropic from "@anthropic-ai/sdk";

import { meterIssues, meterReport } from "./prosody-lint";

export const POLISH_MODEL = "claude-sonnet-5-5";

type Args = { language: string; style: string; brief: string; lyrics: string };

async function ask(client: Anthropic, prompt: string): Promise<string> {
  const res = await client.messages.create({ model: POLISH_MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] });
  const out = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  if (out.length < 20) throw new Error(`empty polish output (stop=${res.stop_reason})`);
  return out;
}

/**
 * Meter/diction polish applied to a committed PCE lyric. Minimal edits only: sections, length and imagery stay.
 * A deterministic akshara-count lint (prosody-lint.ts) tells the model exactly which paired lines do not sing to one
 * tune; after the edit the lint runs again and a second, targeted pass fixes only what is still off.
 */
export async function polishLyrics(client: Anthropic, a: Args): Promise<string> {
  const before = meterIssues(a.lyrics);
  const meterNote = before.length
    ? `\nA deterministic meter check found these paired lines whose syllable counts differ too much to sing to one tune. Rewrite ONLY these lines (keep their meaning/imagery) so each pair is within +-2 syllables:\n${meterReport(before)}\n`
    : "";
  let out = await ask(client, `You are a senior lyricist and prosody editor in ${a.language} (style family: ${a.style}).
Brief: ${a.brief}
Here is a draft song lyric chosen by a selection engine. Edit it minimally:
1. PROSODY: make paired lines match in syllable/akshara count and stress so they sing to one tune; fix broken rhyme/prasa/anuprasa where the style expects it.
2. DICTION: use natural spoken-poetic register for the style; fix spelling, sandhi and any translated-sounding phrasing; keep native script only.
3. FRESHNESS: replace any stock film-lyric cliche with a specific image from the brief.
Keep the section tags, the number of lines and the overall length (about 8 short lines for a 30-second song). Do not add commentary. Output ONLY the final lyrics.
${meterNote}
--- DRAFT ---
${a.lyrics}`);
  const after = meterIssues(out);
  if (after.length) {
    try {
      out = await ask(client, `Fix the meter of this ${a.language} song lyric. Only these paired lines still differ too much in syllable count; rewrite ONLY them so each pair is within +-2 syllables, keeping meaning, imagery, script and every other line unchanged. Output ONLY the full lyrics.\n${meterReport(after)}\n\n--- LYRICS ---\n${out}`);
    } catch { /* keep the first pass */ }
  }
  return out;
}
