/**
 * Dynamic OG image for /s/[publicId] (1200x630, PNG). Uses Next's
 * built-in ImageResponse, so the only runtime dep is a couple of
 * server-side fonts (system fallback is fine for now).
 *
 * Falls back to a generic "Song on neo-fm" card if the publicId
 * doesn't resolve or the song row has been re-privatized.
 */
import { ImageResponse } from "next/og";
import { z } from "zod";

import { createServerClient } from "@/lib/supabase/server";
import {
  fontFamilyFor,
  pickExcerpt,
  reorderForSatori,
  waveformBars,
} from "@/lib/share/card";
import { loadFontsFor, shapeLine, type ShapedLine } from "@/lib/share/shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "neo-fm song";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PublicIdSchema = z
  .string()
  .regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

export default async function OgImage({
  params,
}: {
  params: { publicId: string };
}) {
  let title = "neo-fm";
  let subtitle = "AI music, India-first";
  let excerpt: string[] = [];
  let seed = params.publicId;

  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (idCheck.success) {
    const supabase = createServerClient();
    const { data } = await supabase
      .from("jobs")
      .select(
        `
        public_id,
        published_visibility,
        song_documents ( document_json, language, style_family, title )
      `,
      )
      .eq("public_id", idCheck.data)
      .in("published_visibility", ["public", "unlisted"])
      .maybeSingle<{
        public_id: string;
        published_visibility: "public" | "unlisted" | "private";
        song_documents: {
          document_json: {
            style_family: string;
            language: string;
            target_duration_seconds: number;
            raga?: { name: string };
            sections?: { type?: string; lyrics?: string; script?: string }[];
          };
          language: string;
          style_family: string;
          title: string | null;
        } | null;
      }>();
    // Query is limited to public/unlisted, so private songs never get
    // their lyrics rendered into a cacheable image.
    if (data?.song_documents) {
      const doc = data.song_documents.document_json;
      excerpt = pickExcerpt(doc.sections);
      seed = data.public_id;
      const stored = data.song_documents.title?.trim();
      title =
        stored && stored.length > 0
          ? stored
          : `${prettyStyle(doc.style_family)} song`;
      subtitle = doc.raga
        ? `${prettyStyle(doc.style_family)} · raga ${doc.raga.name} · ${prettyLanguage(doc.language)} · neo-fm`
        : `${prettyStyle(doc.style_family)} · ${prettyLanguage(doc.language)} · ${doc.target_duration_seconds}s · neo-fm`;
    }
  }

  const excerptText = excerpt.join("\n");
  // Shaped vector lines when HarfBuzz works; otherwise plain text with
  // the bundled font (conjuncts may look off in that fallback).
  const shaped: (ShapedLine | null)[] = await Promise.all(
    excerpt.map((l) => shapeLine(l, 40)),
  );
  const allShaped = shaped.length > 0 && shaped.every((s) => s !== null);
  const fonts = excerptText && !allShaped ? await loadFontsFor(excerptText) : [];
  const bars = waveformBars(seed);
  const excerptFamily = fontFamilyFor(excerptText);

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
          background:
            "linear-gradient(135deg, #0a0612 0%, #1b0e2c 55%, #321656 100%)",
          color: "#fef7ea",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 24,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: "rgba(254, 247, 234, 0.55)",
          }}
        >
          <span>neo-fm</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: excerpt.length > 0 ? 72 : 96,
              fontWeight: 500,
              letterSpacing: -2,
              lineHeight: 1.05,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 36,
              color: "rgba(254, 247, 234, 0.75)",
              letterSpacing: -0.5,
            }}
          >
            {subtitle}
          </div>
          {excerpt.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 22,
                paddingLeft: 24,
                borderLeft: "4px solid #f0b35a",
                fontFamily: `"${excerptFamily}", system-ui, sans-serif`,
                fontSize: 40,
                lineHeight: 1.4,
                color: "#fef7ea",
              }}
            >
              {excerpt.map((line, i) => {
                const sh = shaped[i];
                return sh ? (
                  <svg
                    key={i}
                    width={sh.width}
                    height={sh.height}
                    viewBox={`0 0 ${sh.width} ${sh.height}`}
                  >
                    <path d={sh.d} fill="#fef7ea" />
                  </svg>
                ) : (
                  <div key={i}>{reorderForSatori(line)}</div>
                );
              })}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 90,
          }}
        >
          {bars.map((b, i) => (
            <div
              key={i}
              style={{
                width: 12,
                height: Math.max(8, Math.round(b * 90)),
                borderRadius: 6,
                background: i % 5 === 0 ? "#f0b35a" : "rgba(240,179,90,0.55)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "rgba(254, 247, 234, 0.4)",
            fontSize: 22,
            letterSpacing: 1,
          }}
        >
          <span>composition-aware</span>
          <span>raga · tala · script</span>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}

function prettyStyle(s: string): string {
  if (s === "western") return "Western";
  if (s === "carnatic") return "Carnatic";
  if (s === "hindustani") return "Hindustani";
  if (s === "kannada-folk") return "Kannada folk";
  return s;
}
function prettyLanguage(l: string): string {
  if (l === "en") return "English";
  if (l === "hi") return "Hindi";
  if (l === "kn") return "Kannada";
  return l;
}
