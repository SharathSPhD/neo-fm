/**
 * GET /api/songs/[id]/stems
 *
 * Returns signed URLs (1h TTL) for every stem registered against
 * this job. Gating is Creator+ tier in v1.1; Free users get a 402
 * with a "creator_tier_required" hint so the UI can route them to
 * /pricing.
 *
 * Until the worker is wired to upload stems (Sprint H plan), the
 * `track_stems` table will be empty for all jobs and this route
 * returns `{ stems: [] }`.
 */
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const TRACK_BUCKET_PREFIX = "tracks/";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  // Gate on tier. Free tier users see the UI but the download is locked.
  const { data: profile } = await supabase
    .from("users")
    .select("tier")
    .eq("id", user.id)
    .maybeSingle();
  const tier = (profile?.tier ?? "free") as string;
  if (tier === "free") {
    return NextResponse.json(
      { error: "creator_tier_required", current_tier: tier },
      { status: 402 },
    );
  }

  // Verify ownership and pull the stems list.
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const stemsRes = await (
    supabase.from("track_stems" as never) as unknown as {
      select: (s: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => Promise<{
            data:
              | { kind: string; url: string; bytes: number | null; format: string }[]
              | null;
          }>;
        };
      };
    }
  )
    .select("kind, url, bytes, format")
    .eq("job_id", params.id)
    .order("kind", { ascending: true });

  const stems: {
    kind: string;
    url: string;
    bytes: number | null;
    format: string;
  }[] = [];
  for (const row of stemsRes.data ?? []) {
    const path = row.url.startsWith(TRACK_BUCKET_PREFIX)
      ? row.url.slice(TRACK_BUCKET_PREFIX.length)
      : row.url;
    const { data: signed } = await supabase.storage
      .from("tracks")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!signed?.signedUrl) continue;
    stems.push({
      kind: row.kind,
      url: signed.signedUrl,
      bytes: row.bytes,
      format: row.format,
    });
  }

  return NextResponse.json({ stems });
}
