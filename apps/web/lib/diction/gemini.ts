import { scoreTranscript, type DictionScore } from "./index";

const MODEL = () => process.env.GEMINI_QA_MODEL ?? "gemini-2.5-flash";

/** Gemini audio understanding: transcribe the sung audio in its original script. Cheap (~1.2k tokens per clip). */
export async function transcribeSung(
  audio: Uint8Array, mimeType: string, language: string, apiKey: string, fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `This is a sung ${language} song. Transcribe exactly what is sung, in the original ${language} script, one line per sung line. Do not correct, translate or add anything. Reply as JSON {"transcript": string}.` },
          { inline_data: { mime_type: mimeType || "audio/mpeg", data: Buffer.from(audio).toString("base64") } },
        ],
      }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`gemini qa ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try { return String((JSON.parse(text) as { transcript?: unknown }).transcript ?? ""); } catch { return text; }
}

export async function auditDiction(
  lyrics: string, audio: Uint8Array, mimeType: string, language: string, apiKey: string, fetchImpl: typeof fetch = fetch,
): Promise<DictionScore & { transcript: string }> {
  const transcript = await transcribeSung(audio, mimeType, language, apiKey, fetchImpl);
  return { ...scoreTranscript(lyrics, transcript), transcript };
}
