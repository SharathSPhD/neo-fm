/** Share card for /u/[handle] (1200x630). Falls back to a generic neo-fm card for unknown handles. */
import { ImageResponse } from "next/og";

import { avatarColors, avatarInitial, groupByLanguage, profileStats, type ProfileSong } from "@/lib/profile/summary";
import { prettyLanguage } from "@/lib/song/labels";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "neo-fm creator";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  let found = false;
  let songs: ProfileSong[] = [];

  const supabase = createServerClient();
  const { data: profile } = await (
    supabase.from("public_profiles" as never) as unknown as {
      select: (s: string) => {
        eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string } | null }> };
      };
    }
  )
    .select("id")
    .eq("handle", handle)
    .maybeSingle();

  if (profile) {
    found = true;
    const { data } = await supabase
      .from("jobs")
      .select("id, public_id, published_at, song_documents!inner ( title, language, style_family )")
      .eq("user_id", profile.id)
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .not("public_id", "is", null)
      .limit(200)
      .returns<
        {
          id: string;
          public_id: string;
          published_at: string | null;
          song_documents: { title: string | null; language: string; style_family: string };
        }[]
      >();
    songs = (data ?? []).map((r) => ({
      id: r.id,
      public_id: r.public_id,
      published_at: r.published_at,
      title: r.song_documents.title,
      language: r.song_documents.language,
      style_family: r.song_documents.style_family,
      like_count: 0,
    }));
  }

  const stats = profileStats(songs);
  const langs = groupByLanguage(songs)
    .slice(0, 4)
    .map((g) => prettyLanguage(g.language))
    .join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #0a0612 0%, #1b0e2c 55%, #321656 100%)",
          color: "#fef7ea",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 6, textTransform: "uppercase", color: "rgba(254,247,234,0.55)" }}>
          neo-fm
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <div
            style={{
              width: 180,
              height: 180,
              borderRadius: 90,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 88,
              fontWeight: 600,
              backgroundImage: `linear-gradient(135deg, ${avatarColors(handle).from}, ${avatarColors(handle).to})`,
            }}
          >
            {found ? avatarInitial(handle) : "♬"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 84, fontWeight: 500, letterSpacing: -2, lineHeight: 1.05 }}>
              {found ? `@${handle}` : "Songs in your language"}
            </div>
            <div style={{ fontSize: 34, color: "rgba(254,247,234,0.75)" }}>
              {found && stats.songs > 0
                ? `${stats.songs} ${stats.songs === 1 ? "song" : "songs"}${langs ? ` · ${langs}` : ""}`
                : "AI music, India-first"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(254,247,234,0.4)", fontSize: 22 }}>
          <span>AI-generated music and lyrics</span>
          <span>neo-fm</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
