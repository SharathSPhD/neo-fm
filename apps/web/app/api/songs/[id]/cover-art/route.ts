/**
 * POST /api/songs/[id]/cover-art
 *
 * Generates a cover-art image for the song using the Hugging Face
 * Inference API (Z-Image-Turbo by default). The PNG bytes are
 * uploaded to the `cover-art` bucket and a `cover_art` row is
 * inserted (migration 0026).
 *
 * If `HUGGINGFACE_API_TOKEN` isn't configured, the route returns 503
 * so the UI can fall back to the deterministic placeholder.
 *
 * GET returns the most-recent cover-art row for the song with a
 * signed URL (1h TTL).
 */
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const COVER_ART_MODEL =
  process.env.NEO_FM_COVER_ART_MODEL ?? "tonyassi/z-image-turbo";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const dynamic = "force-dynamic";

interface SongRow {
  id: string;
  song_documents: {
    title: string | null;
    language: string;
    style_family: string;
    document_json: {
      raga?: { name?: string };
      orchestration?: { texture?: string };
    } | null;
  } | null;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const probe = await (
    supabase.from("cover_art" as never) as unknown as {
      select: (s: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          eq: (
            col2: string,
            val2: boolean,
          ) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{
                  data: { url: string; created_at: string } | null;
                }>;
              };
            };
          };
        };
      };
    }
  )
    .select("url, created_at")
    .eq("job_id", params.id)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!probe.data) {
    return NextResponse.json({ url: null });
  }

  const objectPath = probe.data.url.replace(/^cover-art\//, "");
  const { data: signed } = await supabase.storage
    .from("cover-art")
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json({
    url: signed?.signedUrl ?? null,
    created_at: probe.data.created_at,
  });
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  if (!HF_TOKEN) {
    return NextResponse.json(
      {
        error: "cover_art_disabled",
        details: "HUGGINGFACE_API_TOKEN not configured on the server.",
      },
      { status: 503 },
    );
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  // Load enough of the song to build a tasteful prompt. Ownership
  // is implicit (RLS).
  const { data: song, error: songErr } = await supabase
    .from("jobs")
    .select(
      `
      id,
      song_documents (
        title, language, style_family, document_json
      )
    `,
    )
    .eq("id", params.id)
    .maybeSingle<SongRow>();
  if (songErr || !song?.song_documents) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const title = song.song_documents.title?.trim() ?? "an Indian classical song";
  const style = song.song_documents.style_family;
  const raga = song.song_documents.document_json?.raga?.name;
  const texture = song.song_documents.document_json?.orchestration?.texture;
  const promptParts = [
    `Album cover art for "${title}"`,
    `${style} musical style`,
    raga ? `raga ${raga}` : null,
    texture ? `${texture} texture` : null,
    "elegant, atmospheric, no text, no watermarks, square 1:1, 4k",
  ].filter(Boolean);
  const prompt = promptParts.join(", ");

  // Call HF inference API.
  const hfRes = await fetch(
    `https://api-inference.huggingface.co/models/${COVER_ART_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "content-type": "application/json",
        accept: "image/png",
      },
      body: JSON.stringify({ inputs: prompt }),
    },
  );
  if (!hfRes.ok) {
    const text = await hfRes.text().catch(() => "");
    return NextResponse.json(
      {
        error: "huggingface_inference_failed",
        details: text,
        status: hfRes.status,
      },
      { status: 502 },
    );
  }
  const bytes = new Uint8Array(await hfRes.arrayBuffer());

  // Upload via service-role so RLS doesn't reject the storage write.
  const svc = createServiceRoleClient();
  const objectPath = `${user.id}/${params.id}/${crypto.randomUUID()}.png`;
  const upload = await svc.storage.from("cover-art").upload(objectPath, bytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (upload.error) {
    return NextResponse.json(
      { error: "upload_failed", details: upload.error.message },
      { status: 500 },
    );
  }

  // Mark old current=true rows as false, then insert the new row.
  const adminCover = svc as unknown as {
    from: (t: string) => {
      update: (r: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
      insert: (
        r: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  await adminCover
    .from("cover_art")
    .update({ is_current: false })
    .eq("job_id", params.id);
  const insertRes = await adminCover.from("cover_art").insert({
    job_id: params.id,
    prompt,
    url: `cover-art/${objectPath}`,
    model_version: COVER_ART_MODEL,
    is_current: true,
  });
  if (insertRes.error) {
    return NextResponse.json(
      { error: "insert_failed", details: insertRes.error.message },
      { status: 500 },
    );
  }

  const { data: signed } = await supabase.storage
    .from("cover-art")
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json({
    url: signed?.signedUrl ?? null,
    model_version: COVER_ART_MODEL,
    prompt,
  });
}
