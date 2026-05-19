"use client";

// Known FakeVocalModel output size — deterministic 10 s × 48 kHz × 16-bit mono WAV.
export const FAKE_PREVIEW_BYTES = 960_044;

// Fundamental frequencies by gender register.
const GENDER_HZ: Record<string, number> = {
  male: 130,
  female: 220,
  androgynous: 175,
};

// BiquadFilter Q by persona — higher Q = more resonant / tonal character.
const PERSONA_Q: Record<string, number> = {
  "broadcast-clear": 0.5,
  "indian-english-announcer": 0.8,
  "radio-jockey": 1.5,
  "neutral": 1.0,
  "warm-storyteller": 4.0,
  "warm-narrator": 4.0,
  "lyrical-warm": 8.0,
  "airy-alto": 5.0,
  "bhajan": 6.0,
  "bhakti": 6.0,
  "classical-paired": 6.0,
  "rabindrasangeet": 6.0,
  "slow-sustained-chant": 9.0,
  "bright-devotional": 7.0,
  "language-default": 1.0,
};

/**
 * HEAD-checks a preview URL to detect FakeVocalModel output.
 * Returns true when content-length exactly equals FAKE_PREVIEW_BYTES.
 */
export async function isFakePreview(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const len = res.headers.get("content-length");
    return len !== null && parseInt(len, 10) === FAKE_PREVIEW_BYTES;
  } catch {
    return false;
  }
}

/**
 * Synthesises a 3-second labeled timbre tone via Web Audio API.
 * Must be called inside a user gesture handler (click) to avoid autoplay policy.
 * The returned AudioContext closes automatically when the tone ends.
 *
 * @param gender  "male" | "female" | "androgynous" — drives fundamental frequency
 * @param persona  voice catalog persona string — drives filter character
 * @param onEnd   called when the tone finishes (≈ 3 s + a 100 ms tail)
 */
export function synthesiseTimbrePreview(
  gender: string,
  persona: string,
  onEnd: () => void,
): void {
  const ctx = new AudioContext();

  const freq = GENDER_HZ[gender] ?? 175;
  const q = PERSONA_Q[persona] ?? 2.0;
  const duration = 3.0;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;

  // Shape with a bandpass filter — higher Q brings out the formant character.
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq * 2;
  filter.Q.value = q;

  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.25, t + 0.12);          // attack
  gain.gain.setValueAtTime(0.25, t + duration - 0.15);        // sustain
  gain.gain.linearRampToValueAtTime(0, t + duration);          // release

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t);
  osc.stop(t + duration);

  osc.onended = () => {
    void ctx.close();
    onEnd();
  };
}
