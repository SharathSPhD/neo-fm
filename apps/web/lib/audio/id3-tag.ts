/**
 * Stamps neo.fm provenance into an MP3 as an ID3v2.4 tag (pure TS, no dependency, runs on Vercel).
 * This is metadata, not a watermark: it survives download and re-share but not re-encoding or tag stripping.
 * Google's inaudible SynthID in Lyria audio is the robust layer; this makes the AI origin readable by any player.
 */
export interface Id3Provenance {
  /** Canonical site URL written to WOAS. */
  site: string;
  generator?: string;
}

const enc = new TextEncoder();
const UTF8 = 3;

function syncsafe(n: number): number[] {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

function frame(id: string, body: number[]): number[] {
  return [...enc.encode(id), ...syncsafe(body.length), 0, 0, ...body];
}

function txxx(desc: string, value: string): number[] {
  return frame("TXXX", [UTF8, ...enc.encode(desc), 0, ...enc.encode(value)]);
}

export function isMp3(buf: Uint8Array): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  return buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0;
}

/** Returns the bytes with a neo.fm ID3v2.4 tag in front of the audio, replacing any existing ID3v2 tag. Non-MP3 input is returned unchanged. */
export function tagMp3(audio: Uint8Array, p: Id3Provenance): Uint8Array {
  if (!isMp3(audio)) return audio;
  let start = 0;
  if (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
    start = 10 + (((audio[6] ?? 0) & 0x7f) << 21 | ((audio[7] ?? 0) & 0x7f) << 14 | ((audio[8] ?? 0) & 0x7f) << 7 | ((audio[9] ?? 0) & 0x7f));
    if ((audio[5] ?? 0) & 0x10) start += 10; // footer present
  }
  const frames = [
    ...txxx("AI_GENERATED", "true"),
    ...txxx("GENERATOR", p.generator ?? "neo.fm (Google Lyria)"),
    // COMM: encoding, language, short description, text
    ...frame("COMM", [UTF8, ...enc.encode("eng"), 0, ...enc.encode(`AI-generated music made on neo.fm (${p.site}). Audio carries Google SynthID.`)]),
    ...frame("WOAS", [...enc.encode(p.site)]),
  ];
  const header = [0x49, 0x44, 0x33, 4, 0, 0, ...syncsafe(frames.length)];
  const out = new Uint8Array(header.length + frames.length + (audio.length - start));
  out.set(header, 0);
  out.set(frames, header.length);
  out.set(audio.subarray(start), header.length + frames.length);
  return out;
}
