/**
 * POST /api/client-errors -- browser error reports from the React error
 * boundaries and window handlers. Anonymous by design (a crash can happen
 * signed out), so the controls are: IP rate limit in middleware, a small body
 * cap, strict schema, and server-side scrubbing (no PII is stored: see
 * lib/obs/client-error.ts). Always answers 204 for well-formed input, even if
 * storage fails, so a broken table can never amplify into client retries.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../lib/agent/adapters";
import { buildRow, ClientErrorSchema } from "../../../lib/obs/client-error";
import { getLogger } from "../../../lib/obs/log";
import { requestIdOf } from "../../../lib/obs/request-id";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16_000;
// Retention is enforced opportunistically; a real scheduler can call prune_client_errors() instead.
const PRUNE_ONE_IN = 200;

export async function POST(req: NextRequest) {
  const log = getLogger("/api/client-errors", req);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ClientErrorSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const row = buildRow(parsed.data, { userAgent: req.headers.get("user-agent"), requestId: requestIdOf(req) });
  try {
    const db = serviceClient();
    const { error } = await db.from("client_errors").insert(row);
    if (error) log.warn("client_error_store_failed", { detail: error.message });
    else if (Math.floor(Math.random() * PRUNE_ONE_IN) === 0) {
      const { error: pruneErr } = await db.rpc("prune_client_errors");
      if (pruneErr) log.warn("client_error_prune_failed", { detail: pruneErr.message });
    }
  } catch (err) {
    log.warn("client_error_store_failed", { err });
  }
  log.info("client_error", { fingerprint: row.fingerprint, boundary: row.boundary, page: row.route, message: row.message });
  return new NextResponse(null, { status: 204 });
}
