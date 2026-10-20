/**
 * Volume ramps for the end and start of tracks inside a set (lib/station/sets.ts). iOS Safari ignores writes to
 * audio.volume, so the ramp is skipped there and the tracks simply join with a hard cut.
 */
type Volumed = Pick<HTMLAudioElement, "volume">;

/** True when this browser honours audio.volume (probed once: write a value and read it back). */
export function canSetVolume(audio: Volumed): boolean {
  const before = audio.volume;
  try {
    audio.volume = before > 0.5 ? 0.25 : 0.75;
    const worked = Math.abs(audio.volume - (before > 0.5 ? 0.25 : 0.75)) < 0.01;
    audio.volume = before;
    return worked;
  } catch {
    return false;
  }
}

/** Linear ramp of audio.volume to `to` over `ms`; returns a cancel function. Jumps straight to `to` when ms <= 0. */
export function rampVolume(audio: Volumed, to: number, ms: number, now: () => number = () => performance.now()): () => void {
  const from = audio.volume;
  if (ms <= 0 || from === to) { audio.volume = to; return () => undefined; }
  const start = now();
  const id = setInterval(() => {
    const p = Math.min(1, (now() - start) / ms);
    audio.volume = Math.min(1, Math.max(0, from + (to - from) * p));
    if (p >= 1) clearInterval(id);
  }, 50);
  return () => clearInterval(id);
}
