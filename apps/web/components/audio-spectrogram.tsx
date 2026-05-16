"use client";

/**
 * <AudioSpectrogram> -- live FFT-driven canvas analyser that hangs
 * off any <audio> element. Wow-factor #1 from the v1.1 plan.
 *
 * Usage:
 *
 *     const audioRef = useRef<HTMLAudioElement>(null);
 *     <audio ref={audioRef} src={url} controls />
 *     <AudioSpectrogram audioRef={audioRef} />
 *
 * Design notes:
 *   - We lazy-instantiate the AudioContext on the first `play` event;
 *     browsers reject any AudioContext construction before a user
 *     gesture. We also keep the context bound to the parent <audio>
 *     by sharing a single MediaElementAudioSourceNode -- one element
 *     can't be wired into multiple source nodes, so the hook caches
 *     by element identity on `audioRef.current`.
 *   - The drawing loop draws a moving frequency-domain "waterfall":
 *     each frame we shift the canvas left by 2 px and draw a vertical
 *     spectrum slice on the right. That gives a sense of motion and
 *     keeps the canvas readable on low-DPI screens.
 *   - We respect prefers-reduced-motion by drawing a static
 *     spectrum centered on the canvas instead.
 */
import { useEffect, useRef, useState } from "react";

type Props = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  height?: number;
  className?: string;
};

type Cached = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
};

const cache = new WeakMap<HTMLAudioElement, Cached>();

function getOrCreateAnalyser(el: HTMLAudioElement): Cached | null {
  if (cache.has(el)) return cache.get(el)!;
  type ContextCtor = typeof AudioContext;
  const w = window as unknown as {
    AudioContext?: ContextCtor;
    webkitAudioContext?: ContextCtor;
  };
  const Ctor: ContextCtor | undefined = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  const ctx: AudioContext = new Ctor();
  const source = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  const cached = { ctx, source, analyser };
  cache.set(el, cached);
  return cached;
}

export function AudioSpectrogram({
  audioRef,
  height = 96,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let analyser: AnalyserNode | null = null;
    // Use a number[] internally and copy from the analyser each frame
    // via a freshly-allocated Uint8Array, so TS doesn't trip on the
    // SharedArrayBuffer vs ArrayBuffer variance of the DOM lib types.
    let bins = 0;

    function ensure() {
      const cached = getOrCreateAnalyser(audio!);
      if (!cached) return;
      analyser = cached.analyser;
      bins = analyser.frequencyBinCount;
      setReady(true);
    }

    function step() {
      const canvas = canvasRef.current;
      if (!canvas || !analyser || bins === 0) return;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      const { width, height: h } = canvas;
      const freq = new Uint8Array(bins);
      analyser.getByteFrequencyData(freq as never);

      if (reduce) {
        ctx2d.fillStyle = "rgba(0,0,0,0.18)";
        ctx2d.fillRect(0, 0, width, h);
        const barWidth = Math.max(1, Math.floor(width / freq.length));
        for (let i = 0; i < freq.length; i++) {
          const v = (freq[i] ?? 0) / 255;
          const barH = v * (h - 4);
          ctx2d.fillStyle = `hsl(${Math.floor(220 - v * 160)}, 90%, ${30 + v * 50}%)`;
          ctx2d.fillRect(i * barWidth, h - barH, barWidth - 1, barH);
        }
      } else {
        const img = ctx2d.getImageData(2, 0, width - 2, h);
        ctx2d.putImageData(img, 0, 0);
        ctx2d.clearRect(width - 2, 0, 2, h);
        for (let y = 0; y < h; y++) {
          const bin = Math.floor((1 - y / h) * (freq.length - 1));
          const v = (freq[bin] ?? 0) / 255;
          ctx2d.fillStyle = `hsl(${Math.floor(220 - v * 160)}, 90%, ${10 + v * 60}%)`;
          ctx2d.fillRect(width - 2, y, 2, 1);
        }
      }

      raf = requestAnimationFrame(step);
    }

    function onPlay() {
      if (!analyser) ensure();
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(step);
    }
    function onPause() {
      if (raf) cancelAnimationFrame(raf);
    }

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [audioRef]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={height}
      aria-hidden="true"
      className={
        className ??
        "w-full rounded-md border border-muted/20 bg-black/40"
      }
      style={{ height: `${height}px` }}
      data-ready={ready ? "1" : "0"}
    />
  );
}
