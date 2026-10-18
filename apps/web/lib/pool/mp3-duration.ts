/**
 * Duration of an MP3 from its bytes, by walking the MPEG audio frames (no ffprobe on Vercel). Handles ID3v2, CBR and
 * VBR alike because it sums every frame. Returns null when no valid frame run is found.
 */
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function mp3DurationSeconds(buf: Uint8Array): number | null {
  let i = 0;
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    i = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
  }
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      if (frames === 0) { i++; continue; }
      break;
    }
    const version = (buf[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 3; // 1 = layer III
    const br = (buf[i + 2] >> 4) & 15;
    const sr = (buf[i + 2] >> 2) & 3;
    const pad = (buf[i + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) {
      if (frames === 0) { i++; continue; }
      break;
    }
    const kbps = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[br];
    const rate = RATES[version][sr];
    const samples = version === 3 ? 1152 : 576;
    const len = Math.floor((samples / 8) * kbps * 1000 / rate) + pad;
    seconds += samples / rate;
    frames++;
    i += len;
  }
  return frames >= 10 ? seconds : null;
}
