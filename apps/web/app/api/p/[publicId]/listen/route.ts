/**
 * POST /api/p/[publicId]/listen   { kind: "play" | "share" }
 *
 * Anonymous, write-only counter for creator insights. Records which published song was played or shared and the
 * listener's primary language subtag, nothing else: no user id, no IP, no user agent. Requests carrying Do Not Track or
 * Global Privacy Control are ignored. The owner's own plays are not counted. Rate limited per IP by the middleware
 * (bucket public:listen). Always answers 204 so the response reveals nothing about the song or the listener.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { LISTEN_KINDS, optedOutOfTracking, primaryLanguage } from "../../../../../lib/insights/listen";
import { createServerClient, createServiceRoleClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const PublicIdSchema = z.string().regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);
const BodySchema = z.object({ kind: z.enum(LISTEN_KINDS) });

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: NextRequest, props: { params: Promise<{ publicId: string }> }) {
  const params = await props.params;
  if (optedOutOfTracking(request.headers)) return noContent();
  const id = PublicIdSchema.safeParse(params.publicId);
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return noContent();

  const svc = createServiceRoleClient();
  const { data: job } = await svc
    .from("jobs")
    .select("id,user_id")
    .eq("public_id", id.data)
    .in("published_visibility", ["public", "unlisted"])
    .maybeSingle<{ id: string; user_id: string }>();
  if (!job) return noContent();

  // A creator replaying their own song must not inflate their numbers.
  try {
    const { data } = await createServerClient().auth.getUser();
    if (data?.user?.id === job.user_id) return noContent();
  } catch {
    /* anonymous listeners have no session */
  }

  await svc
    .from("song_listens" as never)
    .insert({ job_id: job.id, kind: body.data.kind, lang: primaryLanguage(request.headers.get("accept-language")) } as never);
  return noContent();
}
