/** GET /api/admin/ads[?days=7] -- house-ad starts, completes and taps per slot, spot inventory by language and daypart with a modelled sponsor value, and the next-day-return guardrail (Bearer admin). Read-only; empty before migration 0099. */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { adInventory, passUpsellStats, retentionGuardrail, summarizeAds } from "../../../../lib/ops/ads-report";
import { inAdHoldout } from "../../../../lib/station/ads";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Rows = { data: Record<string, unknown>[] | null; error?: unknown };

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = serviceClient() as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { gte: (k: string, v: string) => { limit: (n: number) => Promise<Rows> } }; gte: (k: string, v: string) => { limit: (n: number) => Promise<Rows> }; limit: (n: number) => Promise<Rows> } } };
  try {
    const [slots, events] = await Promise.all([
      db.from("ad_slots").select("id,headline,kind,languages,active,cta_url").limit(200),
      db.from("ad_events").select("slot_id,event,created_at").gte("created_at", since).limit(20_000),
    ]);
    // A missing table reads as an empty report, so the panel can ship before the migration.
    if (slots.error || events.error) return NextResponse.json({ window_days: days, slots: [] });
    // Rollback rule: next-day return of ad listeners vs the held-out control, over the last 14 days (free signed-in only).
    const guardSince = new Date(Date.now() - 14 * 86_400_000).toISOString();
    let guardrail = null;
    try {
      const [users, plays] = await Promise.all([
        db.from("users").select("id,tier").limit(20_000),
        db.from("station_signals").select("user_id,created_at").eq("kind", "play").gte("created_at", guardSince).limit(50_000),
      ]);
      if (!users.error && !plays.error) guardrail = retentionGuardrail((users.data ?? []) as never, (plays.data ?? []) as never, (id) => inAdHoldout(id));
    } catch { /* the guardrail is optional */ }
    return NextResponse.json({
      window_days: days,
      slots: summarizeAds((slots.data ?? []) as never, (events.data ?? []) as never),
      inventory: adInventory((slots.data ?? []) as never, (events.data ?? []) as never, days),
      pass_upsell: passUpsellStats((slots.data ?? []) as never, (events.data ?? []) as never),
      retention_guardrail: guardrail,
    });
  } catch {
    return NextResponse.json({ window_days: days, slots: [] });
  }
}
