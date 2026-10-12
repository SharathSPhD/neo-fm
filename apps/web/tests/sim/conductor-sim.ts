/**
 * Virtual-time load simulation of the conductor (cron tick -> processJobs -> advance).
 * The real `advance()` runs against mocked Managed Agents sessions and a mocked Lyria; only the scheduling policy
 * around it (claim cap, batch concurrency, lease, function deadline) is re-implemented, mirroring lib/agent/process.ts.
 * No network, no spend. Requires vi.useFakeTimers() in the caller.
 */
import { vi } from "vitest";
import { advance, type AgentEvent, type RunRow, type RunStore, type SessionApi } from "../../lib/agent/runner";

export type Tier = "free" | "creator" | "pro";

export interface Policy {
  name: string;
  /** Queued jobs promoted to processing per tick. */
  maxClaim: number;
  /** Jobs advanced at once. */
  concurrency: number;
  /** "batch": Promise.all over fixed slices (current code). "pool": sliding window. */
  mode: "batch" | "pool";
  /** Order for claiming and for picking the next job to advance. */
  order: "fifo" | "weighted-aging";
  leaseS: number;
  maxDurationS: number;
  /** Fraction of claims reserved for the lowest tier when it is waiting (weighted-aging only). */
  tickIntervalS: number;
}

export const CURRENT: Policy = { name: "current", maxClaim: 3, concurrency: 4, mode: "batch", order: "fifo", leaseS: 280, maxDurationS: 300, tickIntervalS: 60 };

export interface Latency {
  /** Agent session time from outcome kickoff to its generate_music call. */
  agentThinkS: Record<Tier, number>;
  /** Time from our tool result to the session going idle. */
  agentWrapS: number;
  renderS: Record<Tier, number>;
  apiCallS: number;
  /** Max sessions the provider runs at once (Infinity = unconstrained). */
  agentSlots: number;
}

export const DEFAULT_LATENCY: Latency = {
  agentThinkS: { free: 150, creator: 240, pro: 240 },
  agentWrapS: 45,
  renderS: { free: 25, creator: 70, pro: 70 },
  apiCallS: 0.5,
  agentSlots: Infinity,
};

interface SimJob {
  id: string; tier: Tier; submittedAt: number;
  status: "queued" | "processing" | "done" | "failed";
  startedAt?: number; leaseUntil?: number; doneAt?: number; failReason?: string;
}
interface SimSession { startedAt: number; resultAt?: number }

const WEIGHT: Record<Tier, number> = { pro: 3, creator: 2, free: 1 };
const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
const HANG = () => new Promise<never>(() => {});

export interface SimResult {
  jobs: { id: string; tier: Tier; minutes: number | null; status: string; failReason?: string }[];
  ticks: number;
  killedTicks: number;
}

export async function simulate(opts: {
  policy: Policy;
  latency?: Latency;
  arrivals: { atS: number; tier: Tier }[];
  horizonS?: number;
}): Promise<SimResult> {
  const P = opts.policy;
  const L = opts.latency ?? DEFAULT_LATENCY;
  const t0 = Date.now();
  const nowS = () => (Date.now() - t0) / 1000;
  const jobs = new Map<string, SimJob>();
  const runs = new Map<string, RunRow>();
  const sessions = new Map<string, SimSession>();
  let sessionSeq = 0;
  let ticks = 0, killedTicks = 0;

  // Provider-side session capacity: each slot is busy from session start until its wrap-up ends.
  const slotFree: number[] = Array.from({ length: Number.isFinite(L.agentSlots) ? L.agentSlots : 10_000 }, () => 0);

  const store: RunStore = {
    async get(id) { return runs.get(id) ?? null; },
    async upsert(r) { runs.set(r.job_id, { ...(runs.get(r.job_id) ?? { job_id: r.job_id, session_id: null, lyria_calls: 0, audio_path: null, status: "pending" as const }), ...r } as RunRow); },
    async claimStart(id) { if (runs.has(id)) return false; runs.set(id, { job_id: id, session_id: null, lyria_calls: 0, audio_path: null, status: "pending" }); return true; },
    async claimRender(id, max) { const r = runs.get(id)!; if (r.lyria_calls >= max) return null; r.lyria_calls++; return r.lyria_calls; },
  };

  function sessionApiFor(job: SimJob): SessionApi {
    const sess = (sid: string) => sessions.get(sid)!;
    return {
      async create() { await sleep(L.apiCallS); const id = `s${++sessionSeq}`; sessions.set(id, { startedAt: Infinity }); return { id }; },
      async sendOutcome(sid) {
        await sleep(L.apiCallS);
        // A session beyond the provider's slot limit only starts when a slot frees.
        const start = Math.max(nowS(), Math.min(...slotFree));
        slotFree[slotFree.indexOf(Math.min(...slotFree))] = start + L.agentThinkS[job.tier] + L.renderS[job.tier] + L.agentWrapS;
        sess(sid).startedAt = start;
      },
      async listEvents(sid) {
        await sleep(L.apiCallS * 2);
        const s = sess(sid); const ev: AgentEvent[] = [];
        if (nowS() >= s.startedAt + L.agentThinkS[job.tier]) ev.push({ id: `c-${sid}`, type: "agent.custom_tool_use", name: "generate_music", input: { style_prompt: "s", lyrics: "l", duration_class: "full" } });
        if (s.resultAt !== undefined) {
          ev.push({ id: `r-${sid}`, type: "user.custom_tool_result", custom_tool_use_id: `c-${sid}` });
          if (nowS() >= s.resultAt + L.agentWrapS) ev.push({ id: `i-${sid}`, type: "session.status_idle", stop_reason: { type: "end_turn" } });
        }
        return ev;
      },
      async sendToolResult(sid) { await sleep(L.apiCallS); sess(sid).resultAt = nowS(); },
      async sendToolConfirmation() {},
      async status() { await sleep(L.apiCallS); return "idle"; },
    };
  }

  function pickOrder(list: SimJob[], key: (j: SimJob) => number): SimJob[] {
    if (P.order === "fifo") return [...list].sort((a, b) => a.submittedAt - b.submittedAt);
    // Weighted aging: score = tier weight x time waited. Pro goes first when fresh, but a long-waiting free job overtakes.
    const now = nowS();
    return [...list].sort((a, b) => WEIGHT[b.tier] * (now - key(b) + 1) - WEIGHT[a.tier] * (now - key(a) + 1));
  }

  async function runJob(job: SimJob, deadlineS: number) {
    if ((job.leaseUntil ?? 0) > nowS()) return; // busy
    job.leaseUntil = nowS() + P.leaseS;
    const api = sessionApiFor(job);
    // Sessions are per job; remember mapping so repeated advances reuse the same simulated session.
    const row = runs.get(job.id);
    const sid = row?.session_id;
    const sessionsForJob: SessionApi = sid ? { ...api, create: api.create } : api;
    try {
      const out = await advance(job.id, {
        sessions: sessionsForJob, store, environmentId: "e", agentId: "a", maxLyriaCalls: 1, maxOutcomeIterations: 1,
        brief: { language: "hi", styleFamily: "x", targetSeconds: 60, prompt: "p" },
        music: async () => {
          await sleep(L.renderS[job.tier]);
          // Function killed at its deadline: the render result is lost and the lease is never released.
          if (nowS() > deadlineS) await HANG();
          return { audio: new Uint8Array(1), mimeType: "audio/mpeg", model: "sim" };
        },
        saveAudio: async (id, n) => `${id}/${n}.mp3`,
      });
      if (out === "done") {
        const r = runs.get(job.id)!;
        if (r.audio_path) { job.status = "done"; } else { job.status = "failed"; job.failReason = "finished without audio"; }
        job.doneAt = nowS();
      }
    } finally {
      job.leaseUntil = undefined;
    }
  }

  async function tick() {
    ticks++;
    const deadline = nowS() + P.maxDurationS;
    const queued = pickOrder([...jobs.values()].filter((j) => j.status === "queued"), (j) => j.submittedAt).slice(0, P.maxClaim);
    for (const j of queued) { j.status = "processing"; j.startedAt = nowS(); }
    const active = pickOrder([...jobs.values()].filter((j) => j.status === "processing"), (j) => j.startedAt ?? j.submittedAt);
    // The real code lists processing jobs in database order; fifo keeps that stable order.
    const settle = async () => {
      if (P.mode === "batch") {
        for (let i = 0; i < active.length; i += P.concurrency) {
          if (nowS() > deadline) { killedTicks++; return; }
          await Promise.all(active.slice(i, i + P.concurrency).map((j) => runJob(j, deadline)));
        }
      } else {
        let next = 0;
        const worker = async () => {
          while (next < active.length) {
            if (nowS() > deadline) { killedTicks++; return; }
            const j = active[next++]!;
            await runJob(j, deadline);
          }
        };
        await Promise.all(Array.from({ length: Math.min(P.concurrency, active.length) }, worker));
      }
    };
    await settle();
  }

  const arrivals = [...opts.arrivals].sort((a, b) => a.atS - b.atS);
  let ai = 0;
  const horizon = opts.horizonS ?? 3 * 3600;
  for (let s = 0; s <= horizon; s++) {
    while (ai < arrivals.length && arrivals[ai]!.atS <= s) {
      const a = arrivals[ai++]!; const id = `j${ai}`;
      jobs.set(id, { id, tier: a.tier, submittedAt: nowS(), status: "queued" });
    }
    if (s % P.tickIntervalS === 0 && s > 0) void tick().catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    if (ai >= arrivals.length && [...jobs.values()].every((j) => j.status === "done" || j.status === "failed")) break;
  }
  return {
    ticks, killedTicks,
    jobs: [...jobs.values()].map((j) => ({ id: j.id, tier: j.tier, status: j.status, failReason: j.failReason, minutes: j.doneAt !== undefined ? (j.doneAt - j.submittedAt) / 60 : null })),
  };
}

export function stats(r: SimResult, tier?: Tier) {
  const xs = r.jobs.filter((j) => (!tier || j.tier === tier) && j.minutes !== null && j.status === "done").map((j) => j.minutes!).sort((a, b) => a - b);
  const failed = r.jobs.filter((j) => (!tier || j.tier === tier) && j.status !== "done").length;
  const q = (p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : NaN);
  return { n: xs.length, failed, p50: q(0.5), p95: q(0.95), max: xs[xs.length - 1] ?? NaN };
}
