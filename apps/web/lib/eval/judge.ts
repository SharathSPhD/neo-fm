import type Anthropic from "@anthropic-ai/sdk";

export const JUDGE_MODEL = "claude-sonnet-5-5";
export const BASELINE_MODEL = "claude-haiku-5-5";

const RUBRIC = `You are a senior lyricist and native-level editor in the target language. Compare two song lyrics written for the same brief.
Judge on: (1) fresh, specific imagery without stock clichés; (2) native, idiomatic language (not translated-sounding); (3) singability and form: consistent line lengths, clear sections, natural stresses; (4) emotional coherence with the brief.
Ignore length unless one is padded or too thin. You do not know how either was made. Reply with ONLY JSON: {"winner":"A"|"B"|"tie","reason":"<=40 words"}.`;

export async function singleShot(client: Anthropic, language: string, style: string, brief: string): Promise<string> {
  const res = await client.messages.create({
    model: BASELINE_MODEL, max_tokens: 1400, thinking: { type: "disabled" },
    messages: [{ role: "user", content: `Write original song lyrics in ${language} (native script only, no transliteration, no translation) in the style family "${style}". Brief: ${brief}. Use section tags like [Pallavi]/[Charanam] or [Verse]/[Chorus] as fits the style, singable line lengths. Output only the lyrics.` }],
  });
  return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}

async function once(client: Anthropic, language: string, brief: string, a: string, b: string): Promise<"A" | "B" | "tie"> {
  const res = await client.messages.create({
    model: JUDGE_MODEL, max_tokens: 300, thinking: { type: "disabled" }, system: RUBRIC,
    messages: [{ role: "user", content: `Language: ${language}\nBrief: ${brief}\n\n=== LYRIC A ===\n${a}\n\n=== LYRIC B ===\n${b}` }],
  });
  const text = res.content.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("");
  try {
    const w = (JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { winner?: string }).winner;
    return w === "A" || w === "B" ? w : "tie";
  } catch { return "tie"; }
}

/** Blind pairwise judgement run in both orders; a win needs both orders to agree, otherwise tie (removes position bias). */
export async function judgePair(client: Anthropic, language: string, brief: string, pce: string, single: string) {
  const [first, second] = await Promise.all([
    once(client, language, brief, pce, single),   // pce = A
    once(client, language, brief, single, pce),   // pce = B
  ]);
  const pceWins = (first === "A" ? 1 : 0) + (second === "B" ? 1 : 0);
  const singleWins = (first === "B" ? 1 : 0) + (second === "A" ? 1 : 0);
  const winner = pceWins === 2 ? "pce" : singleWins === 2 ? "single" : "tie";
  return { winner: winner as "pce" | "single" | "tie", detail: { order_pce_first: first, order_pce_second: second } };
}
