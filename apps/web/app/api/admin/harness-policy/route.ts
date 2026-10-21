/**
 * /api/admin/harness-policy -- operator and QA hook for the harness policy (Bearer ADMIN_SECRET). No model calls, no spend.
 *
 *   POST {action:"state", language?}                               Policy rows, global posteriors and open choices; also whether HARNESS_POLICY is on in this deployment.
 *   POST {action:"pick", language, tier, user_id?, seed?}           Dry run of the arm choice (nothing is recorded). Same code path the polish step uses.
 *   POST {action:"promote", language, tier?, arm_id, role?, max_share?}   Adds or updates a harness_policy row. Only for arms that passed the eval gate.
 *   POST {action:"retire", language, tier?, arm_id}                 Removes a row (the flags decide again if none are left).
 *   POST {action:"judge", language, tier?, arm_id, wins, ties, losses}    Adds a judged battle (e.g. the Haiku proxy judge vs the champion) to the global posterior.
 *   POST {action:"settle", limit?, min_age_hours?}                  Turns listener events on finished songs into posterior updates. Idempotent. min_age_hours 0 lets QA settle a fresh song.
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { POLICY_ARMS, pickArm, policyEnabled, seedFor } from "../../../../lib/harness-policy/policy";
import { addJudgeResult, loadPolicyRows, loadStats, settleChoices } from "../../../../lib/harness-policy/store";

export const dynamic = "force-dynamic";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export async function POST(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = str(b?.action);
  const db = serviceClient();
  const language = str(b?.language);
  const tier = str(b?.tier) || "*";
  const arm_id = str(b?.arm_id);

  if (action === "state") {
    const rows = await loadPolicyRows(db);
    let q = db.from("harness_arm_stats").select("language,tier,arm_id,a,b").is("user_id", null);
    if (language) q = q.eq("language", language);
    const { data: stats } = await q;
    const { count } = await db.from("harness_arm_choices").select("job_id", { count: "exact", head: true }).is("settled_at", null);
    return NextResponse.json({ enabled: policyEnabled(process.env), arms: Object.keys(POLICY_ARMS), rows, stats: stats ?? [], open_choices: count ?? 0 });
  }
  if (action === "pick") {
    if (!language) return NextResponse.json({ error: "language required" }, { status: 400 });
    const userId = str(b?.user_id) || null;
    const [rows, stats] = await Promise.all([loadPolicyRows(db), loadStats(db, language, tier, userId)]);
    const seed = typeof b?.seed === "number" ? b.seed : seedFor(`${language}|${tier}|${userId ?? ""}|${Date.now()}`);
    // The dry run answers "what would the policy do", so it ignores the deployment flag but still honours the same table and rules.
    const pick = pickArm({ env: { ...process.env, HARNESS_POLICY: "1" }, language, tier, rows, global: stats.global, user: stats.user, premiumModel: undefined, seed });
    return NextResponse.json({ enabled: policyEnabled(process.env), pick: { arm: pick.arm.id, source: pick.source, reason: pick.reason }, seed });
  }
  if (action === "promote" || action === "retire" || action === "judge") {
    if (!language || !POLICY_ARMS[arm_id]) return NextResponse.json({ error: `language and arm_id (${Object.keys(POLICY_ARMS).join("|")}) required` }, { status: 400 });
    if (action === "retire") {
      const { error } = await db.from("harness_policy").delete().eq("language", language).eq("tier", tier).eq("arm_id", arm_id);
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
    }
    if (action === "judge") {
      await addJudgeResult(db, { language, tier, arm_id, wins: num(b?.wins), ties: num(b?.ties), losses: num(b?.losses) });
      return NextResponse.json({ ok: true });
    }
    const role = b?.role === "challenger" ? "challenger" : "champion";
    const max_share = Math.min(1, Math.max(0, typeof b?.max_share === "number" ? b.max_share : 0.15));
    const { error } = await db.from("harness_policy").upsert({ language, tier, arm_id, role, max_share }, { onConflict: "language,tier,arm_id" });
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, role, max_share });
  }
  if (action === "settle") {
    const hours = typeof b?.min_age_hours === "number" && b.min_age_hours >= 0 ? b.min_age_hours : 24;
    return NextResponse.json(await settleChoices(db, { limit: Math.min(500, num(b?.limit) || 200), minAgeMs: hours * 3600_000 }));
  }
  return NextResponse.json({ error: "action must be state|pick|promote|retire|judge|settle" }, { status: 400 });
}
