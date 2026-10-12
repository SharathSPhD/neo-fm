import React from "react";
void React; // vitest compiles JSX with the classic runtime

import { ImageResponse } from "next/og";

import { fontFamilyFor, reorderForSatori, waveformBars } from "../share/card";
import type { CardFont } from "../share/card";
import { loadFontsFor, loadLatinFont, shapeLine, type ShapedLine } from "../share/shape";

export const COLLECTION_CARD_SIZE = { width: 1200, height: 630 };

const MAX_TITLES = 3;

/** Clamp a line so a very long title can't overflow the card. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * Collection share card: collection title, a few track titles in their own
 * script (shaped with HarfBuzz like the song card), a song count and the
 * waveform motif. Only ever called with public/unlisted collections and
 * published songs; callers pass already-filtered titles.
 */
export async function renderCollectionCard({
  title,
  songTitles,
  songCount,
  seed,
  baseFonts = [],
}: {
  title: string;
  songTitles: string[];
  songCount: number;
  seed: string;
  baseFonts?: CardFont[];
}) {
  const heading = clip(title, 48);
  const lines = songTitles.slice(0, MAX_TITLES).map((t) => clip(t, 40));
  const [shapedHeading, ...shapedLines] = await Promise.all([
    shapeLine(heading, 76),
    ...lines.map((l) => shapeLine(l, 38)),
  ]);
  const allText = [heading, ...lines].join("\n");
  const needFallback =
    (shapedHeading === null && fontFamilyFor(heading) !== fontFamilyFor("a")) ||
    lines.some((l, i) => shapedLines[i] === null && fontFamilyFor(l) !== fontFamilyFor("a"));
  const fonts = [
    ...(baseFonts.length ? baseFonts : [await loadLatinFont()]),
    ...(needFallback ? await loadFontsFor(allText) : []),
  ];
  const bars = waveformBars(seed);
  const countLabel = songCount > 0 ? `${songCount} ${songCount === 1 ? "song" : "songs"}` : "";

  const renderLine = (text: string, shaped: ShapedLine | null, key: string, size: number) =>
    shaped ? (
      // Headroom above the line: vowel signs over the headline stroke
      // (e.g. Devanagari ै) extend above the shaper's baseline box.
      <svg
        key={key}
        width={shaped.width}
        height={shaped.height + Math.round(size * 0.25)}
        viewBox={`0 ${-Math.round(size * 0.25)} ${shaped.width} ${shaped.height + Math.round(size * 0.25)}`}
      >
        <path d={shaped.d} fill="#fef7ea" />
      </svg>
    ) : (
      <div
        key={key}
        style={{ fontFamily: `"${fontFamilyFor(text)}", system-ui, sans-serif`, fontSize: size }}
      >
        {reorderForSatori(text)}
      </div>
    );

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 24,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: "rgba(254, 247, 234, 0.55)",
          }}
        >
          <span>neo-fm · playlist</span>
          <span style={{ color: "#f0b35a" }}>{countLabel}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {renderLine(heading, shapedHeading ?? null, "h", 76)}
          {lines.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                paddingLeft: 24,
                borderLeft: "4px solid #f0b35a",
                color: "rgba(254, 247, 234, 0.9)",
              }}
            >
              {lines.map((l, i) => renderLine(l, shapedLines[i] ?? null, `l${i}`, 38))}
              {songCount > lines.length ? (
                <div style={{ fontSize: 28, color: "rgba(254, 247, 234, 0.55)" }}>
                  {`+ ${songCount - lines.length} more`}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 70 }}>
          {bars.map((b, i) => (
            <div
              key={i}
              style={{
                width: 12,
                height: Math.max(8, Math.round(b * 70)),
                borderRadius: 6,
                background: i % 5 === 0 ? "#f0b35a" : "rgba(240,179,90,0.55)",
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...COLLECTION_CARD_SIZE, fonts },
  );
}
