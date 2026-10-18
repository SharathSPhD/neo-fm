/**
 * Client-side clip export: canvas frames + decoded song audio recorded with
 * MediaRecorder. Nothing is uploaded and no server work is needed; the audio
 * is fetched from the same signed URL the player already uses.
 */
import { drawClipFrame, CLIP_H, CLIP_W } from "./clip-render";
import { muxMp4, type Mp4Sample } from "./mp4-mux";
import type { ClipWindow } from "./clip-plan";
import type { SyncLine } from "@/lib/lyrics/sync";

/** MP4 first (what Instagram and WhatsApp take without re-encoding), WebM where that is all the browser has. */
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickRecorderMime(isSupported: (m: string) => boolean): string | null {
  return MIME_CANDIDATES.find(isSupported) ?? null;
}

export function clipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

export interface ExportClipOptions {
  audioUrl: string;
  coverUrl: string | null;
  lines: readonly SyncLine[];
  window: ClipWindow;
  title: string;
  to: string | null;
  message: string | null;
  seed: string;
  /**
   * Must be created (and resumed) synchronously inside the user's tap: iOS Safari leaves a context made after an
   * await suspended, which stalls the recorder path at 0%. exportClip closes it.
   */
  audioContext: AudioContext;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ExportedClip {
  blob: Blob;
  mime: string;
  ext: "mp4" | "webm";
  seconds: number;
  /** True for H.264/AAC MP4, the one format Instagram and WhatsApp reliably take. */
  instagramSafe: boolean;
}

const FPS = 30;
const SAMPLE_RATE = 48000;
const VIDEO_CODEC = "avc1.420020"; // baseline L3.2: 720x1280 at 30 fps, no B-frames (the muxer relies on that)
const AUDIO_CODEC = "mp4a.40.2";

const toBytes = (d: AllowSharedBufferSource): Uint8Array =>
  ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));

/** True when this browser can encode H.264 + AAC through WebCodecs, so the clip can be an Instagram-safe MP4. */
export async function webCodecsMp4Supported(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined" || typeof VideoFrame === "undefined" || typeof AudioData === "undefined") {
    return false;
  }
  try {
    const [v, a] = await Promise.all([
      VideoEncoder.isConfigSupported({ codec: VIDEO_CODEC, width: CLIP_W, height: CLIP_H, bitrate: 4_000_000, framerate: FPS, avc: { format: "avc" } }),
      AudioEncoder.isConfigSupported({ codec: AUDIO_CODEC, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 128_000 }),
    ]);
    return !!v.supported && !!a.supported;
  } catch {
    return false;
  }
}

async function loadCover(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    // Anonymous CORS keeps the canvas untainted, which captureStream requires.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function exportViaRecorder(o: ExportClipOptions): Promise<ExportedClip> {
  const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("recorder_unsupported");
  const duration = o.window.end - o.window.start;
  if (!(duration > 0)) throw new Error("empty_window");

  const [cover, audioBuf] = await Promise.all([
    loadCover(o.coverUrl),
    fetch(o.audioUrl, { signal: o.signal }).then((r) => {
      if (!r.ok) throw new Error(`audio_fetch_${r.status}`);
      return r.arrayBuffer();
    }),
  ]);

  const ac = o.audioContext;
  try {
    const decoded = await ac.decodeAudioData(audioBuf);
    const canvas = document.createElement("canvas");
    canvas.width = CLIP_W;
    canvas.height = CLIP_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    const fontFamily = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";

    const dest = ac.createMediaStreamDestination();
    const gain = ac.createGain();
    const src = ac.createBufferSource();
    src.buffer = decoded;
    src.connect(gain).connect(dest);
    // Short fades hide the hard cut at both ends of the excerpt.
    const now = ac.currentTime + 0.1;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.4);
    gain.gain.setValueAtTime(1, now + duration - 0.8);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    const stream = canvas.captureStream(30);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });

    const frame = (t: number) =>
      drawClipFrame(ctx, { lines: o.lines, window: o.window, t, title: o.title, to: o.to, message: o.message, cover, seed: o.seed, fontFamily });
    frame(o.window.start);
    rec.start(250);
    src.start(now, o.window.start, duration);

    await new Promise<void>((resolve, reject) => {
      const wallStart = performance.now();
      const tick = () => {
        if (o.signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
        // A context that never leaves "suspended" (iOS without a gesture) keeps currentTime at 0 forever.
        if (ac.currentTime <= now && performance.now() - wallStart > 2000) { reject(new Error("recorder_unsupported")); return; }
        const elapsed = Math.max(0, ac.currentTime - now);
        frame(o.window.start + Math.min(elapsed, duration));
        o.onProgress?.(Math.min(1, elapsed / duration));
        if (elapsed >= duration) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }).finally(() => { if (rec.state !== "inactive") rec.stop(); });
    await stopped;

    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    return { blob, mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm", seconds: duration, instagramSafe: false };
  } finally {
    /* the caller owns and closes the context */
  }
}

/** Offline H.264/AAC path: frames are drawn and encoded as fast as the device allows, then muxed into an MP4. */
async function exportViaWebCodecs(o: ExportClipOptions): Promise<ExportedClip> {
  const duration = o.window.end - o.window.start;
  if (!(duration > 0)) throw new Error("empty_window");
  const [cover, audioBuf] = await Promise.all([
    loadCover(o.coverUrl),
    fetch(o.audioUrl, { signal: o.signal }).then((r) => {
      if (!r.ok) throw new Error(`audio_fetch_${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const decoded = await o.audioContext.decodeAudioData(audioBuf);
  const canvas = document.createElement("canvas");
  canvas.width = CLIP_W;
  canvas.height = CLIP_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  const fontFamily = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";

  const videoSamples: Mp4Sample[] = [];
  const audioSamples: Mp4Sample[] = [];
  let avcC: Uint8Array | null = null;
  let asc: Uint8Array | null = null;
  let failure: Error | null = null;
  const grab = (chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array => {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    return data;
  };

  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !avcC) avcC = toBytes(d);
      videoSamples.push({ data: grab(chunk), timestampUs: chunk.timestamp, durationUs: chunk.duration ?? 1e6 / FPS, key: chunk.type === "key" });
    },
    error: (e) => { failure = e; },
  });
  venc.configure({ codec: VIDEO_CODEC, width: CLIP_W, height: CLIP_H, bitrate: 4_000_000, framerate: FPS, avc: { format: "avc" }, latencyMode: "quality" });
  const aenc = new AudioEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !asc) asc = toBytes(d);
      audioSamples.push({ data: grab(chunk), timestampUs: chunk.timestamp, durationUs: chunk.duration ?? (1024 * 1e6) / decoded.sampleRate, key: true });
    },
    error: (e) => { failure = e; },
  });
  aenc.configure({ codec: AUDIO_CODEC, sampleRate: decoded.sampleRate, numberOfChannels: 2, bitrate: 128_000 });

  try {
    // Audio: slice the excerpt, fade both ends, feed as planar float32 stereo.
    const rate = decoded.sampleRate;
    const first = Math.floor(o.window.start * rate);
    const total = Math.min(Math.floor(duration * rate), decoded.length - first);
    const left = decoded.getChannelData(0).subarray(first, first + total);
    const right = (decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)).subarray(first, first + total);
    const fadeIn = Math.floor(0.4 * rate);
    const fadeOut = Math.floor(0.8 * rate);
    const BLOCK = 4096;
    for (let at = 0; at < total; at += BLOCK) {
      const n = Math.min(BLOCK, total - at);
      const planar = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const k = at + i;
        const g = Math.min(1, k / fadeIn, (total - k) / fadeOut);
        planar[i] = left[k]! * g;
        planar[n + i] = right[k]! * g;
      }
      const data = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at * 1e6) / rate), data: planar });
      aenc.encode(data);
      data.close();
    }

    // Video: one canvas frame per tick of the clip, with back-pressure so memory stays flat.
    const frames = Math.ceil(duration * FPS);
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (failure) throw failure;
      drawClipFrame(ctx, { lines: o.lines, window: o.window, t: o.window.start + i / FPS, title: o.title, to: o.to, message: o.message, cover, seed: o.seed, fontFamily });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      if (i % 5 === 0) { o.onProgress?.(i / frames); await new Promise((r) => setTimeout(r, 0)); }
    }
    await Promise.all([venc.flush(), aenc.flush()]);
    if (failure) throw failure;
    if (!avcC || !asc || videoSamples.length === 0) throw new Error("encoder_no_output");
    o.onProgress?.(1);
    const mp4 = muxMp4(
      { width: CLIP_W, height: CLIP_H, avcC, samples: videoSamples },
      { sampleRate: rate, channels: 2, audioSpecificConfig: asc, samples: audioSamples },
    );
    return { blob: new Blob([mp4 as BlobPart], { type: "video/mp4" }), mime: "video/mp4", ext: "mp4", seconds: duration, instagramSafe: true };
  } finally {
    if (venc.state !== "closed") venc.close();
    if (aenc.state !== "closed") aenc.close();
  }
}

/** H.264/AAC MP4 where WebCodecs can encode it; otherwise record the canvas in real time. */
export async function exportClip(o: ExportClipOptions): Promise<ExportedClip> {
  try {
    if (await webCodecsMp4Supported()) return await exportViaWebCodecs(o);
    return await exportViaRecorder(o);
  } finally {
    void o.audioContext.close().catch(() => undefined);
  }
}
