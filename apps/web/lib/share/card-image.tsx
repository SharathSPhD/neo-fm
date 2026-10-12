import React from "react";
void React; // vitest compiles JSX with the classic runtime

import { ImageResponse } from "next/og";

import {
  EXCERPT_SCRIPTS_ENABLED,
  detectScript,
  fontFamilyFor,
  reorderForSatori,
  waveformBars,
} from "./card";
import type { CardFont } from "./card";
import { loadFontsFor, shapeLine, type ShapedLine } from "./shape";

export const CARD_SIZE = { width: 1200, height: 630 };

/**
 * Renders the share card. Shared by the OG route and the fixture
 * renderer so what we review is what ships. A script whose excerpt is
 * switched off in EXCERPT_SCRIPTS_ENABLED gets the title-only card.
 */
export async function renderShareCard({
  title,
  subtitle,
  excerpt: rawExcerpt,
  seed,
  baseFonts = [],
}: {
  title: string;
  subtitle: string;
  excerpt: string[];
  seed: string;
  /** Latin face for environments where next/og can't find its own (tests). */
  baseFonts?: CardFont[];
}) {
  const size = CARD_SIZE;
  const excerpt = EXCERPT_SCRIPTS_ENABLED[detectScript(rawExcerpt.join("\n"))]
    ? rawExcerpt
    : [];
  const excerptText = excerpt.join("\n");
  // Shaped vector lines when HarfBuzz works; otherwise plain text with
  // the bundled font (conjuncts may look off in that fallback).
  const shaped: (ShapedLine | null)[] = await Promise.all(
    excerpt.map((l) => shapeLine(l, 40)),
  );
  const allShaped = shaped.length > 0 && shaped.every((s) => s !== null);
  const fonts = [
    ...baseFonts,
    ...(excerptText && !allShaped ? await loadFontsFor(excerptText) : []),
  ];
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
