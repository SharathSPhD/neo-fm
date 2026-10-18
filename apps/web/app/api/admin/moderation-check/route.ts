/**
 * POST /api/admin/moderation-check (Bearer ADMIN_SECRET)
 * Body: { prompts: string[] (max 100), kind?: "brief" | "lyrics", system?: string }
 * Runs each prompt through the moderator and returns verdicts by index, so a prompt edit can be spot-checked on
 * prod's own key before it ships. `system` overrides the moderator prompt for this call only. Nothing is stored and
 * prompt text is never logged or echoed back. Cost: one Haiku call per prompt that passes the deterministic rules.
 */
import { NextResponse, type NextRequest } from "next/server";

import { anthropicClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { moderate } from "../../../../lib/safety/moderate";
import { screenText } from "../../../../lib/safety/policy";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 120;

const MAX_PROMPTS = 100;
const CONCURRENCY = 5;

export async function POST(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { prompts?: unknown; kind?: unknown; system?: unknown } | null;
  const prompts = body?.prompts;
  if (!Array.isArray(prompts) || prompts.length === 0 || prompts.length > MAX_PROMPTS || !prompts.every((p) => typeof p === "string")) {
    return NextResponse.json({ error: `prompts must be 1-${MAX_PROMPTS} strings` }, { status: 400 });
  }
  const kind = body?.kind === "lyrics" ? "lyrics" : "brief";
  const system = typeof body?.system === "string" && body.system.trim() ? body.system : undefined;
  const client = anthropicClient();
  const results: { i: number; allowed: boolean; layer: "rules" | "model"; category?: string }[] = new Array(prompts.length);
  let next = 0;
  const worker = async () => {
    while (next < prompts.length) {
      const i = next++;
      const text = prompts[i] as string;
      const rule = screenText(text, kind);
      const v = rule.allowed ? await moderate(client, text, kind, system) : rule;
      results[i] = { i, allowed: v.allowed, layer: rule.allowed ? "model" : "rules", ...(v.allowed ? {} : { category: v.category }) };
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const blocked = results.filter((r) => !r.allowed).length;
  return NextResponse.json({ total: results.length, allowed: results.length - blocked, blocked, results });
}
