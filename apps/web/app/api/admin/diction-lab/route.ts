/**
 * POST /api/admin/diction-lab { language, lyrics, style? }  (Bearer CRON_SECRET / AGENT_TICK_SECRET)
 * Renders the same lyrics as Lyria clips under 3 prompt variants (native script / native + romanization / romanized only),
 * has Gemini transcribe each, and returns the character error rate against the intended lyrics. Spends ~3 clip renders
 * per call (admin experiment; bypasses user envelopes on purpose, so it is Bearer-gated).
 */
import { NextResponse, type NextRequest } from "next/server";
import Sanscript from "@indic-transliteration/sanscript";

import { checkBearer } from "../../../../lib/agent/auth";
import { generateMusic, type SpendGuard } from "../../../../lib/agent/lyria";
import { charErrorRate } from "../../../../lib/diction";
import { transcribeSung } from "../../../../lib/diction/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SCHEME: Record<string, string> = { kannada: "kannada", tamil: "tamil", telugu: "telugu", hindi: "devanagari", bengali: "bengali" };
const noGuard: SpendGuard = { reserve: async () => true, release: async () => {} };
const roman = (t: string, scheme: string) => Sanscript.t(t, scheme, "itrans").replace(/[èé]/g, "e");

export async function POST(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "no_gemini_key" }, { status: 503 });
  const { language, lyrics, style } = (await req.json()) as { language: string; lyrics: string; style?: string };
  const scheme = SCHEME[language.toLowerCase()];
  if (!scheme || !lyrics) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const lines = lyrics.split("\n").map((l) => l.trim()).filter(Boolean);
  const st = style ?? "A folk-light melody with acoustic guitar and tabla, warm female vocal, 30 seconds.";
  const variants: Record<string, string> = {
    native: `Lyrics (${language}):\n${lines.join("\n")}`,
    "native+roman": `Lyrics (${language}), each line followed by its romanization to guide pronunciation:\n${lines.map((l) => `${l}\n(${roman(l, scheme)})`).join("\n")}`,
    roman: `Lyrics (${language}, romanized):\n${lines.map((l) => roman(l, scheme)).join("\n")}`,
  };
  const out: Record<string, unknown> = {};
  await Promise.all(Object.entries(variants).map(async ([name, body]) => {
    try {
      const r = await generateMusic({ stylePrompt: st, lyrics: body, durationClass: "clip" }, { guard: noGuard, apiKey: key });
      const tr = await transcribeSung(r.audio, r.mimeType, language, key);
      out[name] = { cer: Math.round(charErrorRate(lines.join(" "), tr) * 1000) / 1000, transcript: tr.slice(0, 160) };
    } catch (e) { out[name] = { error: String((e as Error).message).slice(0, 120) }; }
  }));
  return NextResponse.json(out);
}
