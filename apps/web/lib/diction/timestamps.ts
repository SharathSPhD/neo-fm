import { charErrorRate } from "./index";

const MODEL = () => process.env.GEMINI_QA_MODEL ?? "gemini-3.8-flash";

/** One lyric line placed on the audio timeline. `startS`/`endS` are seconds from the start of the file. */
export interface LineTiming { i: number; text: string; startS: number; endS: number; cer: number; sung: boolean }
export interface Segment { startS: number; text: string }

/** Accepts seconds as a number or string, or "m:ss(.f)" / "h:mm:ss", which Gemini sometimes returns instead. */
export function parseTime(v: unknown): number {
  if (typeof v === "number") return v;
  const parts = String(v ?? "").trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Gemini audio understanding with time anchors: one entry per sung line, start in seconds. */
export async function transcribeTimed(
  audio: Uint8Array, mimeType: string, language: string, apiKey: string, fetchImpl: typeof fetch = fetch,
): Promise<Segment[]> {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `This is a sung ${language} song. List every sung line in order with the time in seconds at which the singer begins that line. Reply as JSON {"segments":[{"start":number,"text":string}]}.` },
          { inline_data: { mime_type: mimeType || "audio/mpeg", data: Buffer.from(audio).toString("base64") } },
        ],
      }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`gemini timed qa ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: { segments?: { start?: unknown; text?: unknown }[] };
  try { parsed = JSON.parse(text); } catch { return []; }
  return (parsed.segments ?? [])
    .map((s) => ({ startS: parseTime(s.start), text: String(s.text ?? "") }))
    .filter((s) => Number.isFinite(s.startS) && s.startS >= 0 && s.text.trim());
}

const norm = (t: string) => t.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/**
 * Aligns lyric lines to the timed transcript. Segment texts are laid end to end as one character stream where each
 * character carries a time (segment start, linearly spread to the next segment's start), then each lyric line takes the
 * best-matching window from the cursor on (same idea as scoreTranscript), so segments split finer or coarser than the
 * lyric lines still land on the right start time. Lines whose best window exceeds `maxCer` are `sung: false`, and get
 * times interpolated from their neighbours so a UI always has a monotonic timeline. Section tags and blank lines are
 * the caller's job to strip.
 */
export function alignLines(lines: string[], segments: Segment[], durationS: number, maxCer = 0.45): LineTiming[] {
  const segs = [...segments].sort((a, b) => a.startS - b.startS);
  const chars: string[] = []; const times: number[] = [];
  segs.forEach((seg, k) => {
    const cs = Array.from(norm(seg.text));
    const end = segs[k + 1]?.startS ?? durationS;
    cs.forEach((c, j) => { chars.push(c); times.push(seg.startS + ((end - seg.startS) * j) / Math.max(1, cs.length)); });
  });
  const out: LineTiming[] = lines.map((text, i) => ({ i, text, startS: NaN, endS: NaN, cer: 1, sung: false }));
  let cursor = 0;
  lines.forEach((line, i) => {
    const len = Array.from(norm(line)).length;
    if (!len || !chars.length) return;
    let best = { cer: 1, s: cursor, e: cursor };
    const lo = Math.max(0, cursor - Math.ceil(len * 0.3));
    const hi = Math.min(chars.length - 1, cursor + Math.ceil(len * 0.6));
    for (let s = lo; s <= hi; s++) {
      for (const w of [Math.floor(len * 0.8), len, Math.ceil(len * 1.2)]) {
        const e = Math.min(chars.length, s + w);
        const cer = charErrorRate(line, chars.slice(s, e).join(""));
        if (cer < best.cer) best = { cer, s, e };
      }
    }
    if (best.cer > maxCer) return;
    const target = out[i];
    const startT = times[best.s];
    if (!target || startT === undefined) return;
    const endT = times[best.e] ?? durationS;
    Object.assign(target, { startS: startT, endS: Math.max(endT, startT), cer: best.cer, sung: true });
    cursor = best.e;
  });
  out.forEach((line, i) => {
    if (line.sung) return;
    const prev = out.slice(0, i).reverse().find((l) => Number.isFinite(l.endS));
    const nxt = out.slice(i + 1).find((l) => l.sung);
    line.startS = prev?.endS ?? 0;
    line.endS = Math.max(line.startS, nxt?.startS ?? durationS);
  });
  return out;
}

/** Storage/API shape for synced lyrics. Seconds are snake_case to match jsonb columns; `sung:false` lines are interpolated. */
export interface LineTimingsPayload {
  version: 1;
  duration_s: number;
  source: string;
  lines: { i: number; text: string; start_s: number; end_s: number; sung: boolean }[];
}

export function toPayload(lines: LineTiming[], durationS: number): LineTimingsPayload {
  const r = (n: number) => Math.round(n * 10) / 10;
  return { version: 1, duration_s: r(durationS), source: MODEL(), lines: lines.map((l) => ({ i: l.i, text: l.text, start_s: r(l.startS), end_s: r(l.endS), sung: l.sung })) };
}
