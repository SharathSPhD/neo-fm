/**
 * GET /api/admin/ma-sandbox -- one-off capability probe: asks a Managed Agents session to run a few
 * read-only shell checks (python, numpy/scipy, pip reachability) and returns what the sandbox reports.
 * Auth: Bearer CRON_SECRET / AGENT_TICK_SECRET. Uses the free agent (Haiku); costs a few cents.
 */
import { NextResponse, type NextRequest } from "next/server";

import { anthropicClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { mintEmbedToken } from "../../../../lib/agent/embed-token";
import { agentIdFor, requireId } from "../../../../lib/agent/tiers";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const engineChecks = (url: string, token: string) => [
  "find / -name run_cascade.py -not -path '*/proc/*' 2>/dev/null | head -2",
  `timeout 20 curl -sS -o /dev/null -w 'embed:%{http_code}\\n' -X POST ${url}/embed -H 'Authorization: Bearer ${token}' -H 'content-type: application/json' -d '{"texts":["hi"]}' 2>&1 | tail -1`,
  "timeout 20 pip download --no-deps -d /tmp/p six 2>&1 | tail -1",
  "timeout 10 curl -sS -o /dev/null -w 'example:%{http_code}\\n' https://example.com 2>&1 | tail -1",
];
const CHECKS = [
  "python3 --version",
  "python3 -c \"import numpy; print('numpy', numpy.__version__)\"",
  "python3 -c \"import scipy; print('scipy', scipy.__version__)\"",
  "pip --version",
  "timeout 15 pip download --no-deps -d /tmp/p six 2>&1 | tail -2",
  "timeout 10 curl -sS -o /dev/null -w 'hf:%{http_code}\\n' https://huggingface.co 2>&1 | tail -1",
  "nproc; free -m | head -2; df -h /mnt 2>/dev/null | tail -1",
];

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", ...auth.diag }, { status: 401 });
  const client = anthropicClient();
  const env = requireId("MA_ENVIRONMENT_ID", process.env.MA_ENVIRONMENT_ID, "env_");
  const s = await client.beta.sessions.create({ agent: agentIdFor("free"), environment_id: env, title: "sandbox probe" });
  await client.beta.sessions.events.send(s.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: "Diagnostic request from the operator. Run each of these shell commands exactly once with the bash tool, in order, and then reply with the raw output of each (no commentary):\n" + [...(process.env.EMBED_URL && process.env.EMBED_TOKEN ? engineChecks(process.env.EMBED_URL.trim(), mintEmbedToken(process.env.EMBED_TOKEN.trim(), 300)) : []), ...CHECKS].join("\n") }] }],
  });
  const confirmed = new Set<string>();
  const t0 = Date.now();
  let out: unknown[] = [];
  while (Date.now() - t0 < 50_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const ev = (await client.beta.sessions.events.list(s.id, { limit: 100 })) as unknown as { data: Record<string, unknown>[] };
    const data = ev.data ?? [];
    for (const e of data) {
      if (e.type === "agent.tool_use" && !confirmed.has(String(e.id))) {
        confirmed.add(String(e.id));
        await client.beta.sessions.events.send(s.id, { events: [{ type: "user.tool_confirmation", tool_use_id: String(e.id), result: "allow" }] }).catch(() => undefined);
      }
    }
    out = data;
    const last = [...data].reverse().find((e) => String(e.type).startsWith("session.status"));
    if (last?.type === "session.status_idle" && (last as { stop_reason?: { type?: string } }).stop_reason?.type === "end_turn") break;
  }
  const texts = (out as { type: string; content?: { type: string; text?: string }[] }[])
    .filter((e) => e.type === "agent.message" || e.type === "agent.tool_result")
    .map((e) => (e.content ?? []).map((c) => c.text ?? "").join(""));
  return NextResponse.json({ session: s.id, waited_ms: Date.now() - t0, events: out.length, texts });
}
