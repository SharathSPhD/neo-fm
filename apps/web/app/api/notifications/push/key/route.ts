/** GET /api/notifications/push/key -> { enabled, publicKey? }. The public VAPID key is public by design. */
import { NextResponse } from "next/server";

import { pushConfig } from "../../../../../lib/notifications/push";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = pushConfig();
  return NextResponse.json(cfg ? { enabled: true, publicKey: cfg.publicKey } : { enabled: false });
}
