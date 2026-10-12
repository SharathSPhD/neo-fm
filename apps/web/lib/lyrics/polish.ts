import type Anthropic from "@anthropic-ai/sdk";

export const POLISH_MODEL = "claude-sonnet-5-5";

/** Meter/diction polish applied to a committed PCE lyric. Minimal edits only: sections, length and imagery stay. */
export async function polishLyrics(client: Anthropic, a: { language: string; style: string; brief: string; lyrics: string }): Promise<string> {
  const res = await client.messages.create({
    model: POLISH_MODEL, max_tokens: 8000,
    messages: [{ role: "user", content: `You are a senior lyricist and prosody editor in ${a.language} (style family: ${a.style}).
Brief: ${a.brief}
Here is a draft song lyric chosen by a selection engine. Edit it minimally:
1. PROSODY: make paired lines match in syllable/akshara count and stress so they sing to one tune; fix broken rhyme/prasa/anuprasa where the style expects it.
2. DICTION: use natural spoken-poetic register for the style; fix spelling, sandhi and any translated-sounding phrasing; keep native script only.
3. FRESHNESS: replace any stock film-lyric cliche with a specific image from the brief.
Keep the section tags, the number of lines and the overall length (about 8 short lines for a 30-second song). Do not add commentary. Output ONLY the final lyrics.

--- DRAFT ---
${a.lyrics}` }],
  });
  const out = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  if (out.length < 20) throw new Error(`empty polish output (stop=${res.stop_reason})`);
  return out;
}
