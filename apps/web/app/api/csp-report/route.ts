import { NextResponse } from "next/server";

import { summarizeCspReports } from "../../../lib/csp-report";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024;

/** Receives CSP violation reports (Report-Only rollout). Anonymous, size-capped, never echoes input; always 204. */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length <= MAX_BYTES) {
      const v = summarizeCspReports(JSON.parse(raw));
      if (v.length > 0) console.warn("[csp-report]", JSON.stringify(v));
    }
  } catch {
    // malformed report: ignore
  }
  return new NextResponse(null, { status: 204 });
}
