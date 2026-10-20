/** Absolute (pointwise) lyric scoring used to grow the judged corpus. Several lyrics per call keep the cost near USD 0.004 per song. */
export const POINTWISE_DIMS = ["prosody", "diction", "imagery", "cultural", "originality"] as const;
export type PointwiseDim = (typeof POINTWISE_DIMS)[number];
export type PointwiseScores = Record<PointwiseDim, number> & { mean: number };

export interface PointwiseItem { id: string; language: string; brief: string; lyrics: string }

export const POINTWISE_SYSTEM = `You are a senior lyricist and native-level editor. You will see several song lyrics, each in its own language and written for its own brief (a 30-second song).
Score every lyric 1-5 (integers) on:
- prosody: singable meter, consistent line lengths, natural stresses, rhyme/prasa where the style expects it
- diction: native, idiomatic register right for the style (not translated-sounding), correct spelling in native script
- imagery: fresh, specific imagery without stock film-lyric cliches
- cultural: faithful to the culture, season, ritual and emotion the brief names
- originality: avoids stock phrases and formulaic rhymes
Calibration: 3 = a competent AI-written lyric a listener would accept; 4 = clearly good, singable and idiomatic; 5 = outstanding, could be released; 1-2 = broken, translated-sounding or off-brief. Judge quality, not length. Score each lyric on its own merits.
Reply with ONLY JSON: {"scores":[{"id":"<id>","prosody":n,"diction":n,"imagery":n,"cultural":n,"originality":n}, ...]} with one entry per lyric, in the same order.`;

export function pointwisePrompt(items: PointwiseItem[]): string {
  return items.map((x) => `=== LYRIC id=${x.id} ===\nLanguage: ${x.language}\nBrief: ${x.brief}\n${x.lyrics}`).join("\n\n");
}

/** Valid entries only (every dim an integer 1-5, id one of the asked ids); anything else is dropped, never guessed. */
export function parsePointwise(text: string, ids: string[]): Map<string, PointwiseScores> {
  const out = new Map<string, PointwiseScores>();
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { scores?: Record<string, unknown>[] };
    for (const s of Array.isArray(j.scores) ? j.scores : []) {
      const id = String(s.id ?? "");
      if (!ids.includes(id) || out.has(id)) continue;
      const v = {} as PointwiseScores; let sum = 0, ok = true;
      for (const d of POINTWISE_DIMS) {
        const n = Number(s[d]);
        if (!Number.isInteger(n) || n < 1 || n > 5) { ok = false; break; }
        v[d] = n; sum += n;
      }
      if (ok) { v.mean = Math.round((sum / POINTWISE_DIMS.length) * 100) / 100; out.set(id, v); }
    }
  } catch { /* unparseable: caller sees missing ids */ }
  return out;
}
