/**
 * Circuit breaker for the Lyria provider. After `threshold` consecutive outage-class failures (429, 5xx, network;
 * counted per generateMusic call, i.e. after its own retries) the breaker opens and callers fail fast WITHOUT reserving
 * spend or burning a render slot. After the cooldown one probe is let through (half-open); success closes it, failure
 * re-opens it with a doubled cooldown (capped). State is per process: it protects a burst inside one warm function
 * instance, not the fleet.
 */
export interface BreakerOptions {
  threshold?: number;
  cooldownMs?: number;
  maxCooldownMs?: number;
  now?: () => number;
}

export type Gate = { ok: true } | { ok: false; retryInMs: number };

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private cooldown: number;
  private probing = false;
  private probeStartedAt = 0;
  private readonly threshold: number;
  private readonly baseCooldown: number;
  private readonly maxCooldown: number;
  private readonly now: () => number;

  constructor(o: BreakerOptions = {}) {
    this.threshold = o.threshold ?? 3;
    this.baseCooldown = o.cooldownMs ?? 60_000;
    this.maxCooldown = o.maxCooldownMs ?? 5 * 60_000;
    this.cooldown = this.baseCooldown;
    this.now = o.now ?? Date.now;
  }

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.cooldown ? "half-open" : "open";
  }

  /** Ask before starting a paid call. In half-open only one probe is admitted until it reports back (or the cooldown passes again). */
  acquire(): Gate {
    const state = this.state;
    if (state === "closed") return { ok: true };
    if (state === "open") return { ok: false, retryInMs: this.cooldown - (this.now() - (this.openedAt as number)) };
    const probeStale = this.probing && this.now() - this.probeStartedAt >= this.cooldown;
    if (this.probing && !probeStale) return { ok: false, retryInMs: this.cooldown };
    this.probing = true;
    this.probeStartedAt = this.now();
    return { ok: true };
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
    this.cooldown = this.baseCooldown;
  }

  /** `outage` is false for errors that say nothing about provider health (4xx, safety refusal, no-audio): they never trip the breaker. */
  onFailure(outage: boolean): void {
    if (!outage) {
      // A non-outage answer still proves the provider responded; release a half-open probe without counting a failure.
      this.probing = false;
      return;
    }
    this.failures++;
    if (this.openedAt !== null) {
      // Failed probe: re-open with a longer cooldown.
      this.cooldown = Math.min(this.cooldown * 2, this.maxCooldown);
      this.openedAt = this.now();
      this.probing = false;
    } else if (this.failures >= this.threshold) {
      this.openedAt = this.now();
      this.probing = false;
    }
  }
}

/** Outage-class: rate limiting, provider 5xx, or a transport failure (message from generateMusic's `lyria <status>:` errors). */
export function isOutage(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /^lyria (\d{3})/.exec(msg);
  if (m) {
    const s = Number(m[1]);
    return s === 429 || s >= 500;
  }
  if (/^lyria returned no audio/.test(msg)) return false;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|timeout/i.test(msg);
}

/** The shared instance used by the worker. */
export const lyriaBreaker = new CircuitBreaker();
