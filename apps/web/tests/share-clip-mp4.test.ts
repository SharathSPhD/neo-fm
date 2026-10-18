import { afterEach, describe, expect, it, vi } from "vitest";

import { webCodecsMp4Supported } from "@/lib/share/clip-export";
import { muxMp4, type Mp4Sample } from "@/lib/share/mp4-mux";

interface Box { type: string; start: number; end: number; body: number }

function boxes(buf: Uint8Array, from = 0, to = buf.length): Box[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Box[] = [];
  for (let o = from; o < to; ) {
    const size = dv.getUint32(o);
    out.push({ type: String.fromCharCode(...buf.subarray(o + 4, o + 8)), start: o, end: o + size, body: o + 8 });
    o += size;
  }
  return out;
}
const child = (buf: Uint8Array, parent: Box, type: string, skip = 0) => {
  const b = boxes(buf, parent.body + skip, parent.end).find((x) => x.type === type);
  if (!b) throw new Error(`no ${type}`);
  return b;
};

const sample = (fill: number, len: number, i: number, durUs: number, key = false): Mp4Sample => ({
  data: new Uint8Array(len).fill(fill), timestampUs: i * durUs, durationUs: durUs, key,
});

describe("muxMp4", () => {
  const v = Array.from({ length: 6 }, (_, i) => sample(0xa0 + i, 10 + i, i, 33333, i % 3 === 0));
  const a = Array.from({ length: 4 }, (_, i) => sample(0xb0 + i, 7, i, 21333, true));
  const out = muxMp4(
    { width: 720, height: 1280, avcC: Uint8Array.from([1, 66, 0, 32, 255, 225, 0, 0, 0]), samples: v },
    { sampleRate: 48000, channels: 2, audioSpecificConfig: Uint8Array.from([0x11, 0x90]), samples: a },
  );
  const top = boxes(out);

  it("puts ftyp, moov, mdat in that order (fast start)", () => {
    expect(top.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(top[2]!.end).toBe(out.length);
  });

  it("points each track's chunk offset at its own sample bytes", () => {
    const moov = top[1]!;
    const traks = boxes(out, moov.body, moov.end).filter((b) => b.type === "trak");
    expect(traks).toHaveLength(2);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const offsets = traks.map((t) => {
      const stbl = child(out, child(out, child(out, t, "mdia"), "minf"), "stbl");
      const stco = child(out, stbl, "stco");
      return dv.getUint32(stco.body + 8);
    });
    expect(out[offsets[0]!]).toBe(0xa0);
    expect(out[offsets[0]! + v.reduce((n, s) => n + s.data.length, 0)]).toBe(0xb0);
    expect(offsets[1]).toBe(offsets[0]! + v.reduce((n, s) => n + s.data.length, 0));
  });

  it("records sample sizes, sync samples and a duration covering both tracks", () => {
    const moov = top[1]!;
    const [vt] = boxes(out, moov.body, moov.end).filter((b) => b.type === "trak");
    const stbl = child(out, child(out, child(out, vt!, "mdia"), "minf"), "stbl");
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const stsz = child(out, stbl, "stsz");
    expect(dv.getUint32(stsz.body + 8)).toBe(6);
    expect(dv.getUint32(stsz.body + 12)).toBe(10);
    const stss = child(out, stbl, "stss");
    expect([dv.getUint32(stss.body + 4), dv.getUint32(stss.body + 8), dv.getUint32(stss.body + 12)]).toEqual([2, 1, 4]);
    const mvhd = child(out, moov, "mvhd");
    // 6 video frames of 33.333 ms = 200 ms; audio is 4 x 21.333 ms = 85 ms.
    expect(dv.getUint32(mvhd.body + 16)).toBe(200);
  });
});

describe("webCodecsMp4Supported", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubAll = (video: boolean, audio: boolean) => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => ({ supported: video }) });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: async () => ({ supported: audio }) });
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("AudioData", class {});
  };

  it("is false without WebCodecs", async () => {
    expect(await webCodecsMp4Supported()).toBe(false);
  });
  it("needs both an H.264 and an AAC encoder", async () => {
    stubAll(true, true);
    expect(await webCodecsMp4Supported()).toBe(true);
    stubAll(true, false);
    expect(await webCodecsMp4Supported()).toBe(false);
    stubAll(false, true);
    expect(await webCodecsMp4Supported()).toBe(false);
  });
  it("is false when the support probe throws", async () => {
    stubAll(true, true);
    vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => { throw new Error("nope"); } });
    expect(await webCodecsMp4Supported()).toBe(false);
  });
});
