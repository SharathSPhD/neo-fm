/**
 * POST /api/admin/gemini-ping (Bearer ADMIN_SECRET via checkAdminBearer)
 * One tiny Flash text call with the prod key, to confirm the provider accepts it (a 402 means the prepaid balance is gone).
 * Writes nothing and returns only the status, never provider text. Costs a fraction of a penny.
 */
import { NextResponse, type NextRequest } from "next/server";

import { checkAdminBearer } from "../../../../lib/agent/auth";
import { geminiInteract, geminiQaModel } from "../../../../lib/gemini/interactions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_gemini_key" }, { status: 503 });
  try {
    await geminiInteract({ apiKey, model: geminiQaModel(), text: "Reply with the single word ok." });
    return NextResponse.json({ ok: true, status: 200 });
  } catch (e) {
    const status = (e as { status?: number }).status ?? Number(/\b([45]\d\d)\b/.exec(String((e as Error).message))?.[1] ?? 0);
    return NextResponse.json({ ok: false, status: status || null });
  }
}
