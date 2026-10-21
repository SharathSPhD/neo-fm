/**
 * POST /api/admin/showcase-mirror?name=<file>.mp3 (Bearer ADMIN_SECRET via checkAdminBearer): stores the request body, one
 * mp3, in the R2 bucket as `showcase/<name>`, for the /lab/showcase players. Idempotent (an object already in R2 is kept
 * unless ?replace=1), no model call and no spend. Names are lowercase letters, digits and dashes only; bodies over 4 MB are refused
 * (the platform limit is 4.5 MB). Never returns credentials.
 */
import { NextResponse, type NextRequest } from "next/server";

import { checkAdminBearer } from "../../../../lib/agent/auth";
import { r2Configured, r2Request } from "../../../../lib/pool/r2";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const SHOWCASE_NAME = /^[a-z0-9][a-z0-9-]{0,80}\.mp3$/;
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", diag: auth.diag }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ error: "r2_not_configured" }, { status: 503 });
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!SHOWCASE_NAME.test(name)) return NextResponse.json({ error: "bad_name" }, { status: 400 });
  const key = `showcase/${name}`;
  if (req.nextUrl.searchParams.get("replace") !== "1" && (await r2Request("HEAD", key)).status === 200) {
    return NextResponse.json({ key, stored: false, existed: true });
  }
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0 || body.length > MAX_BYTES) return NextResponse.json({ error: "bad_size", bytes: body.length }, { status: 400 });
  // An mp3 starts with an ID3 tag or an MPEG frame sync; anything else is not what the players expect.
  const head = body.subarray(0, 3).toString("latin1");
  if (head !== "ID3" && !(body[0] === 0xff && (body[1]! & 0xe0) === 0xe0)) return NextResponse.json({ error: "not_mp3" }, { status: 400 });
  const put = await r2Request("PUT", key, body);
  if (!put.ok) return NextResponse.json({ error: "r2_put_failed", status: put.status }, { status: 502 });
  return NextResponse.json({ key, stored: true, bytes: body.length });
}
