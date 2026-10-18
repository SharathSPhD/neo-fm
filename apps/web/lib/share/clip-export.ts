/**
 * Client-side clip export: canvas frames + decoded song audio recorded with
 * MediaRecorder. Nothing is uploaded and no server work is needed; the audio
 * is fetched from the same signed URL the player already uses.
 */
import { drawClipFrame, CLIP_H, CLIP_W } from "./clip-render";
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
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ExportedClip {
  blob: Blob;
  mime: string;
  ext: "mp4" | "webm";
  seconds: number;
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

export async function exportClip(o: ExportClipOptions): Promise<ExportedClip> {
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

  const ac = new AudioContext();
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
      const tick = () => {
        if (o.signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
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
    return { blob, mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm", seconds: duration };
  } finally {
    void ac.close();
  }
}
