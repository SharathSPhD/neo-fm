/**
 * Plan and bound a batch of teacher-lyric generations for the lyrics lab (admin route /api/admin/lyrics-teacher).
 * Pure so the limits are unit-tested: the route must never be a general-purpose, unmetered Claude proxy.
 */
import { rates } from "./cost";

export const TEACHER_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type TeacherModel = (typeof TEACHER_MODELS)[number];
export interface TeacherJob { id: string; prompt: string; n: number }
export interface TeacherPlan { model: TeacherModel; system?: string; jobs: TeacherJob[]; maxTokens: number; calls: number; estimateUsd: number; maxUsd: number }

const MAX_JOBS = 60;
const MAX_CALLS = 160;
const MAX_PROMPT_CHARS = 3000;
const HARD_MAX_USD = 6;

export function planTeacher(body: unknown, r = rates()): { ok: true; plan: TeacherPlan } | { ok: false; error: string } {
  const b = body as { model?: unknown; system?: unknown; jobs?: unknown; max_tokens?: unknown; max_usd?: unknown } | null;
  const model = TEACHER_MODELS.find((m) => m === b?.model);
  if (!model) return { ok: false, error: `model must be one of ${TEACHER_MODELS.join(", ")}` };
  if (!Array.isArray(b?.jobs) || b.jobs.length < 1 || b.jobs.length > MAX_JOBS) return { ok: false, error: `jobs must be 1-${MAX_JOBS}` };
  const jobs: TeacherJob[] = [];
  for (const j of b.jobs as Record<string, unknown>[]) {
    const n = j?.n === undefined ? 1 : Number(j.n);
    if (typeof j?.id !== "string" || !j.id || j.id.length > 40 || typeof j.prompt !== "string" || !j.prompt || j.prompt.length > MAX_PROMPT_CHARS || !Number.isInteger(n) || n < 1 || n > 8)
      return { ok: false, error: "each job needs id (<=40 chars), prompt (<=3000 chars) and n 1-8" };
    jobs.push({ id: j.id, prompt: j.prompt, n });
  }
  const calls = jobs.reduce((a, j) => a + j.n, 0);
  if (calls > MAX_CALLS) return { ok: false, error: `at most ${MAX_CALLS} generations per request` };
  const maxTokens = Math.min(Math.max(Number(b.max_tokens) || 600, 100), 800);
  const maxUsd = Math.min(Number(b.max_usd) > 0 ? Number(b.max_usd) : 1, HARD_MAX_USD);
  const system = typeof b.system === "string" && b.system.trim() ? b.system.slice(0, MAX_PROMPT_CHARS) : undefined;
  const rate = r[model]!;
  // input is English instructions (~4 chars/token); Indic output tokenizes heavily, so assume the full max_tokens is used
  const inTok = jobs.reduce((a, j) => a + j.n * (Math.ceil((j.prompt.length + (system?.length ?? 0)) / 4) + 20), 0);
  const estimateUsd = Math.round(((inTok * rate.in + calls * maxTokens * rate.out) / 1e6) * 1000) / 1000;
  if (estimateUsd > maxUsd) return { ok: false, error: `estimate USD ${estimateUsd} exceeds max_usd ${maxUsd}` };
  return { ok: true, plan: { model, system, jobs, maxTokens, calls, estimateUsd, maxUsd } };
}
