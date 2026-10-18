/**
 * Minimal MP4 muxer for one H.264 video track and one AAC-LC audio track, as
 * produced by WebCodecs. Written in-repo (about 200 lines) so the clip export
 * needs no new dependency. Output is a non-fragmented file with the `moov`
 * box before `mdat` (fast start), which is what Instagram and WhatsApp expect.
 *
 * Assumes no B-frames (decode order = presentation order), which holds for the
 * baseline-profile encoder the export configures.
 */

export interface Mp4Sample {
  data: Uint8Array;
  /** Presentation time in microseconds. */
  timestampUs: number;
  /** Duration in microseconds. */
  durationUs: number;
  key: boolean;
}

export interface Mp4VideoTrack {
  width: number;
  height: number;
  /** avcC record (decoderConfig.description when the encoder runs with `avc: { format: "avc" }`). */
  avcC: Uint8Array;
  samples: Mp4Sample[];
}

export interface Mp4AudioTrack {
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig (decoderConfig.description of the AAC encoder). */
  audioSpecificConfig: Uint8Array;
  samples: Mp4Sample[];
}

const VIDEO_TIMESCALE = 90000;
const MOVIE_TIMESCALE = 1000;

const u8 = (...n: number[]) => Uint8Array.from(n);
const u16 = (n: number) => u8((n >> 8) & 255, n & 255);
const u32 = (n: number) => u8((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const str = (s: string) => u8(...Array.from(s).map((c) => c.charCodeAt(0)));
const zeros = (n: number) => new Uint8Array(n);

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = cat(...payload);
  return cat(u32(8 + body.length), str(type), body);
}

const fullBox = (type: string, version: number, flags: number, ...payload: Uint8Array[]) =>
  box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...payload);

const MATRIX = cat(u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000));

/** MPEG-4 descriptor with a one-to-four byte length field. */
function descriptor(tag: number, ...payload: Uint8Array[]): Uint8Array {
  const body = cat(...payload);
  const len: number[] = [];
  let n = body.length;
  len.unshift(n & 127);
  while ((n >>= 7) > 0) len.unshift((n & 127) | 128);
  return cat(u8(tag, ...len), body);
}

function sttsEntries(samples: Mp4Sample[], timescale: number): { count: number; delta: number }[] {
  const out: { count: number; delta: number }[] = [];
  let prevEnd = 0; // in timescale units, so rounding never accumulates drift
  samples.forEach((s, i) => {
    const end = Math.round(((s.timestampUs + s.durationUs) * timescale) / 1e6);
    const start = i === 0 ? Math.round((s.timestampUs * timescale) / 1e6) : prevEnd;
    const delta = Math.max(1, end - start);
    prevEnd = start + delta;
    const last = out[out.length - 1];
    if (last && last.delta === delta) last.count++;
    else out.push({ count: 1, delta });
  });
  return out;
}

function trackDurationUnits(samples: Mp4Sample[], timescale: number): number {
  return sttsEntries(samples, timescale).reduce((a, e) => a + e.count * e.delta, 0);
}

function stbl(sampleEntry: Uint8Array, samples: Mp4Sample[], timescale: number, chunkOffset: number, withStss: boolean): Uint8Array {
  const stts = sttsEntries(samples, timescale);
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), sampleEntry),
    fullBox("stts", 0, 0, u32(stts.length), ...stts.map((e) => cat(u32(e.count), u32(e.delta)))),
    ...(withStss ? [fullBox("stss", 0, 0, u32(keys.length), ...keys.map(u32))] : []),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    fullBox("stsz", 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.data.length))),
    fullBox("stco", 0, 0, u32(1), u32(chunkOffset)),
  );
}

function trak(opts: {
  id: number; video: boolean; width: number; height: number; timescale: number;
  sampleEntry: Uint8Array; samples: Mp4Sample[]; chunkOffset: number;
}): Uint8Array {
  const units = trackDurationUnits(opts.samples, opts.timescale);
  const movieDur = Math.round((units * MOVIE_TIMESCALE) / opts.timescale);
  return box(
    "trak",
    fullBox("tkhd", 0, 3, u32(0), u32(0), u32(opts.id), u32(0), u32(movieDur), zeros(8), u16(0), u16(0),
      u16(opts.video ? 0 : 0x0100), u16(0), MATRIX, u32(opts.width << 16), u32(opts.height << 16)),
    box(
      "mdia",
      fullBox("mdhd", 0, 0, u32(0), u32(0), u32(opts.timescale), u32(units), u16(0x55c4), u16(0)),
      fullBox("hdlr", 0, 0, u32(0), str(opts.video ? "vide" : "soun"), zeros(12), str(opts.video ? "VideoHandler" : "SoundHandler"), u8(0)),
      box(
        "minf",
        opts.video ? fullBox("vmhd", 0, 1, zeros(8)) : fullBox("smhd", 0, 0, zeros(4)),
        box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
        stbl(opts.sampleEntry, opts.samples, opts.timescale, opts.chunkOffset, opts.video),
      ),
    ),
  );
}

function videoEntry(t: Mp4VideoTrack): Uint8Array {
  return box(
    "avc1", zeros(6), u16(1), zeros(16), u16(t.width), u16(t.height), u32(0x00480000), u32(0x00480000),
    zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), box("avcC", t.avcC),
  );
}

function audioEntry(t: Mp4AudioTrack): Uint8Array {
  const esds = fullBox(
    "esds", 0, 0,
    descriptor(0x03, u16(2), u8(0),
      descriptor(0x04, u8(0x40, 0x15), zeros(3), u32(0), u32(0), descriptor(0x05, t.audioSpecificConfig)),
      descriptor(0x06, u8(2))),
  );
  return box("mp4a", zeros(6), u16(1), zeros(8), u16(t.channels), u16(16), u16(0), u16(0), u32(t.sampleRate * 65536), esds);
}

export function muxMp4(video: Mp4VideoTrack, audio: Mp4AudioTrack | null): Uint8Array {
  const ftyp = box("ftyp", str("isom"), u32(512), str("isom"), str("iso2"), str("avc1"), str("mp41"));
  const vBytes = video.samples.reduce((a, s) => a + s.data.length, 0);
  const aBytes = audio ? audio.samples.reduce((a, s) => a + s.data.length, 0) : 0;

  const build = (mdatStart: number): Uint8Array => {
    const vTrak = trak({ id: 1, video: true, width: video.width, height: video.height, timescale: VIDEO_TIMESCALE,
      sampleEntry: videoEntry(video), samples: video.samples, chunkOffset: mdatStart });
    const aTrak = audio
      ? trak({ id: 2, video: false, width: 0, height: 0, timescale: audio.sampleRate,
          sampleEntry: audioEntry(audio), samples: audio.samples, chunkOffset: mdatStart + vBytes })
      : null;
    const movieDur = Math.max(
      Math.round((trackDurationUnits(video.samples, VIDEO_TIMESCALE) * MOVIE_TIMESCALE) / VIDEO_TIMESCALE),
      audio ? Math.round((trackDurationUnits(audio.samples, audio.sampleRate) * MOVIE_TIMESCALE) / audio.sampleRate) : 0,
    );
    return box(
      "moov",
      fullBox("mvhd", 0, 0, u32(0), u32(0), u32(MOVIE_TIMESCALE), u32(movieDur), u32(0x00010000), u16(0x0100),
        zeros(10), MATRIX, zeros(24), u32(audio ? 3 : 2)),
      vTrak,
      ...(aTrak ? [aTrak] : []),
    );
  };

  // moov size does not depend on the offsets, so one trial build fixes the layout.
  const moovSize = build(0).length;
  const moov = build(ftyp.length + moovSize + 8);
  const mdatHeader = cat(u32(8 + vBytes + aBytes), str("mdat"));
  return cat(ftyp, moov, mdatHeader, ...video.samples.map((s) => s.data), ...(audio ? audio.samples.map((s) => s.data) : []));
}
