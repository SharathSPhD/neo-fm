/**
 * Line-level timestamps for stored songs (no Lyria render; ~1 Gemini audio call per song).
 *   GEMINI_API_KEY=... npx tsx scripts/quality/line-timings.mts <audio_dir> <out.json> [ids...]
 * Lyrics come from lyrics-fullB-n10.json by file stem (e.g. kn-1.mp3 -> id kn-1). Prints a monotonicity/coverage summary.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { alignLines, transcribeTimed } from "../../apps/web/lib/diction/timestamps";
import { singable } from "./diction-sweep";

const [dir, out, ...only] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY!;
const items = JSON.parse(readFileSync(new URL("./lyrics-fullB-n10.json", import.meta.url), "utf8")) as { id: string; language: string; lyrics: string }[];
const result: Record<string, unknown> = {};
for (const f of readdirSync(dir).filter((x) => /\.(mp3|wav)$/.test(x))) {
  const id = f.replace(/\.\w+$/, "");
  if (only.length && !only.includes(id)) continue;
  const it = items.find((i) => i.id === id)!;
  const audio = new Uint8Array(readFileSync(`${dir}/${f}`));
  let segs = await transcribeTimed(audio, f.endsWith(".wav") ? "audio/wav" : "audio/mpeg", it.language.toLowerCase(), key);
  if (!segs.length) segs = await transcribeTimed(audio, "audio/mpeg", it.language.toLowerCase(), key); // empty/unparseable reply: one retry
  const lines = alignLines(singable(it.lyrics).split("\n"), segs, 30);
  const mono = lines.every((l, i) => i === 0 || l.startS >= lines[i - 1].startS);
  console.error(id, `segments=${segs.length} lines=${lines.length} sung=${lines.filter((l) => l.sung).length} monotonic=${mono}`, lines.map((l) => l.startS.toFixed(1)).join(","));
  result[id] = { language: it.language, lines, segments: segs };
}
writeFileSync(out, JSON.stringify(result, null, 1));
