"use client";

import type { UiLang } from "@/lib/i18n/ui-strings";

/**
 * Instant "hear the mood" preview for the first-run guide.
 *
 * Synthesised in the browser (a soft drone plus a short phrase in a raga
 * typical of the language), so it plays with zero latency and zero cost.
 * It is a taste of the sound world, NOT a render of the user's song, and
 * the UI says so.
 */

/** Semitone offsets from Sa for the scale used per language. */
export const MOOD_SCALES: Record<UiLang, readonly number[]> = {
  hi: [0, 2, 4, 6, 7, 9, 11, 12], // Yaman
  ta: [0, 1, 4, 5, 7, 8, 11, 12], // Mayamalavagowla
  te: [0, 2, 4, 5, 7, 9, 11, 12], // Shankarabharanam
  kn: [0, 2, 4, 7, 9, 12], // Mohanam
  bn: [0, 1, 3, 5, 7, 8, 10, 12], // Bhairavi
  en: [0, 2, 4, 7, 9, 12], // major pentatonic
};

/** Scale-degree walk for the phrase; wraps onto whatever length the scale has. */
const PHRASE_DEGREES = [0, 1, 2, 4, 3, 2, 1, 2, 0, -1, 0] as const;
const NOTE_SECONDS = 0.5;
const SA_HZ = 174.61; // F3: comfortable for both male and female listeners

export interface PhraseNote {
  freq: number;
  start: number;
  dur: number;
}

export function moodPhrase(lang: UiLang): PhraseNote[] {
  const scale = MOOD_SCALES[lang];
  const span = scale.length - 1; // last entry is the upper Sa
  return PHRASE_DEGREES.map((deg, i) => {
    const octave = Math.floor(deg / span);
    const idx = ((deg % span) + span) % span;
    const semis = scale[idx]! + 12 * octave;
    return {
      freq: SA_HZ * 2 ** (semis / 12),
      start: i * NOTE_SECONDS,
      dur: NOTE_SECONDS * (i === PHRASE_DEGREES.length - 1 ? 2.4 : 1.15),
    };
  });
}

export interface MoodPlayback {
  stop(): void;
  /** Resolves when the phrase finishes or is stopped. */
  done: Promise<void>;
}

export function playMood(lang: UiLang): MoodPlayback | null {
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!Ctor) return null;

  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  const phrase = moodPhrase(lang);
  const total = phrase[phrase.length - 1]!.start + phrase[phrase.length - 1]!.dur + 0.6;

  master.gain.exponentialRampToValueAtTime(0.5, t0 + 0.3);
  master.gain.setValueAtTime(0.5, t0 + total - 0.6);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + total);

  // Tanpura-like drone: Sa and Pa, soft sawtooth through a low-pass.
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 700;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.16;
  droneFilter.connect(droneGain).connect(master);
  const sources: OscillatorNode[] = [];
  for (const ratio of [0.5, 0.75, 1]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = SA_HZ * ratio;
    o.connect(droneFilter);
    o.start(t0);
    o.stop(t0 + total);
    sources.push(o);
  }

  for (const n of phrase) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = n.freq;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = n.freq * 0.006;
    vib.connect(vibDepth).connect(o.frequency);
    const g = ctx.createGain();
    const s = t0 + n.start;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.35, s + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, s + n.dur);
    o.connect(g).connect(master);
    o.start(s);
    vib.start(s);
    o.stop(s + n.dur + 0.05);
    vib.stop(s + n.dur + 0.05);
    sources.push(o, vib);
  }

  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const timer = window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
    finish();
  }, (total + 0.3) * 1000);

  return {
    done,
    stop() {
      window.clearTimeout(timer);
      void ctx.close().catch(() => undefined);
      finish();
    },
  };
}
