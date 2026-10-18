/** Input rules for /api/admin/test-render. Kept out of the route file because Next only allows HTTP-method and config exports there. */
const LABEL = /^[a-z0-9][a-z0-9-]{0,40}$/;

export interface RenderItem { label: string; language: string; lyrics?: string; brief_id?: string; eval_batch?: string; style?: string; target_seconds?: number; native?: boolean }

export function renderCap(env = process.env): number {
  const n = Math.floor(Number(env.TEST_RENDER_MAX ?? 3));
  return Math.min(Math.max(Number.isFinite(n) ? n : 3, 1), 5);
}

export function validateItems(body: unknown, cap: number): { ok: true; items: RenderItem[] } | { ok: false; error: string } {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "items required" };
  if (items.length > cap) return { ok: false, error: `at most ${cap} items per call` };
  for (const it of items as RenderItem[]) {
    if (!it || typeof it.label !== "string" || !LABEL.test(it.label) || typeof it.language !== "string" || !it.language) return { ok: false, error: "each item needs a label (a-z0-9-) and a language" };
    if (it.eval_batch !== undefined && !/^[A-Za-z0-9]{1,12}$/.test(it.eval_batch)) return { ok: false, error: "eval_batch must be a short alphanumeric batch name" };
    if (it.target_seconds !== undefined && !(Number.isFinite(it.target_seconds) && it.target_seconds >= 30 && it.target_seconds <= 180)) return { ok: false, error: "target_seconds must be between 30 and 180" };
    if (it.native !== undefined && typeof it.native !== "boolean") return { ok: false, error: "native must be a boolean" };
    if (!it.lyrics && !it.brief_id) return { ok: false, error: "each item needs lyrics or brief_id" };
  }
  return { ok: true, items: items as RenderItem[] };
}
