/** Input rules for /api/admin/test-render. Kept out of the route file because Next only allows HTTP-method and config exports there. */
const LABEL = /^[a-z0-9][a-z0-9-]{0,40}$/;

export interface RenderItem { label: string; language: string; lyrics?: string; brief_id?: string; style?: string }

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
    if (!it.lyrics && !it.brief_id) return { ok: false, error: "each item needs lyrics or brief_id" };
  }
  return { ok: true, items: items as RenderItem[] };
}
