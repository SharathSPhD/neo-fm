/** Beta-Bernoulli Thompson sampling for harness arms. Mirrors tools/harness-rl/bandit.py; no dependencies. */
export interface Posterior { a: number; b: number }

/** Deterministic PRNG so a pick can be reproduced from a seed (tests, QA hook). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Marsaglia-Tsang gamma sampler (shape >= 0). */
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do { x = gaussian(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(p: Posterior, rng: () => number): number {
  const x = gamma(Math.max(p.a, 1e-3), rng);
  const y = gamma(Math.max(p.b, 1e-3), rng);
  return x / (x + y);
}

export const mean = (p: Posterior): number => p.a / (p.a + p.b);

/** A per-user posterior shrunk toward the language-level one: `strength` pseudo-observations of the prior, so thin personal data cannot swing the pick. */
export function shrink(user: Posterior | undefined, prior: Posterior, strength = 4): Posterior {
  const m = mean(prior);
  const u = user ?? { a: 1, b: 1 };
  return { a: u.a + strength * m, b: u.b + strength * (1 - m) };
}
