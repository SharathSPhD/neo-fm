/**
 * POST /api/admin/ma-setup -- idempotent one-time provisioning of the Managed
 * Agents resources (skill, environment, 4 agents). Auth: Bearer CRON_SECRET.
 * Returns the IDs to paste into MA_ENVIRONMENT_ID / MA_AGENT_ID_FREE / MA_AGENT_ID_PRO.
 * Existing resources are reused by name; nothing is deleted or overwritten.
 */
import { toFile } from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";

import { checkBearer } from "../../../../lib/agent/auth";
import { anthropicClient } from "../../../../lib/agent/adapters";
import {
  environmentParams, freeProducerParams, poetParams, polisherParams, proProducerParams,
} from "../../../../lib/agent/definitions";
import { cleanId } from "../../../../lib/agent/tiers";
import { SKILL_PCE_POEM_MD } from "../../../../lib/agent/skill-pce-poem";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

async function firstByName<T extends { id: string }>(
  iter: AsyncIterable<T>, field: "name" | "display_name", name: string,
): Promise<string | undefined> {
  for await (const item of iter) {
    if ((item as unknown as Record<string, unknown>)[field] === name) return item.id;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", ...auth.diag }, { status: 401 });
  }
  const client = anthropicClient();
  const created: string[] = [];
  try {
    let skillId = await firstByName(client.skills.list(), "display_name", "pce-poem");
    if (!skillId) {
      const s = await client.skills.create({
        display_name: "pce-poem",
        files: [await toFile(Buffer.from(SKILL_PCE_POEM_MD), "pce-poem/SKILL.md", { type: "text/markdown" })],
      });
      skillId = s.id; created.push("skill");
    }
    const env = environmentParams();
    let environmentId = await firstByName(client.beta.environments.list(), "name", env.name);
    if (!environmentId) { environmentId = (await client.beta.environments.create(env)).id; created.push("environment"); }

    const ensureAgent = async (params: { name: string }, make: () => Promise<{ id: string }>) => {
      const existing = await firstByName(client.beta.agents.list(), "name", params.name);
      if (existing) return existing;
      created.push(params.name);
      return (await make()).id;
    };
    const poet = poetParams(skillId);
    const polisher = polisherParams(skillId);
    const poetId = await ensureAgent(poet, () => client.beta.agents.create(poet));
    const polisherId = await ensureAgent(polisher, () => client.beta.agents.create(polisher));
    const free = freeProducerParams(skillId);
    const pro = proProducerParams(skillId, poetId, polisherId);
    const freeId = await ensureAgent(free, () => client.beta.agents.create(free));
    const proId = await ensureAgent(pro, () => client.beta.agents.create(pro));

    return NextResponse.json({
      created,
      MA_ENVIRONMENT_ID: environmentId, MA_AGENT_ID_FREE: freeId, MA_AGENT_ID_PRO: proId,
      skill_id: skillId, poet_id: poetId, polisher_id: polisherId,
      // Booleans only: does each configured env var equal the real ID?
      configured_matches: {
        MA_ENVIRONMENT_ID: cleanId(process.env.MA_ENVIRONMENT_ID) === environmentId,
        MA_AGENT_ID_FREE: cleanId(process.env.MA_AGENT_ID_FREE) === freeId,
        MA_AGENT_ID_PRO: cleanId(process.env.MA_AGENT_ID_PRO) === proId,
      },
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: "setup_failed", status: err.status ?? null, message: String(err.message ?? e).slice(0, 400), created }, { status: 502 });
  }
}
