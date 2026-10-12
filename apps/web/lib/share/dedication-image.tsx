import React from "react";
import { ImageResponse } from "next/og";

import {
  detectScript,
  fontFamilyFor,
  reorderForSatori,
  waveformBars,
  type CardFont,
} from "./card";
import { loadFontsFor, loadLatinFont, shapeLine, type ShapedLine } from "./shape";

void React; // vitest compiles JSX with the classic runtime

export type DedicationVariant = "og" | "story";

export const DEDICATION_SIZES: Record<
  DedicationVariant,
  { width: number; height: number }
> = {
  og: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
};

const hasLatinLetters = (s: string) => /[A-Za-z]/.test(s);
const isIndicOnly = (s: string) =>
  detectScript(s) !== "latin" && !hasLatinLetters(s);

/** Greedy word wrap using real shaped widths (Indic-only text). */
async function wrapShaped(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): Promise<ShapedLine[] | null> {
  const lines: ShapedLine[] = [];
  let current = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i]!;
    const shaped = await shapeLine(candidate, fontSize);
    if (!shaped) return null;
    if (shaped.width > maxWidth && current) {
      const done = await shapeLine(current, fontSize);
      if (!done) return null;
      lines.push(done);
      current = words[i]!;
    } else {
      current = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) {
    const last = await shapeLine(current, fontSize);
    if (!last) return null;
    lines.push(last);
  }
  return lines;
}

function Line({ s, fill }: { s: ShapedLine; fill: string }) {
  return (
    <svg width={s.width} height={s.height} viewBox={`0 0 ${s.width} ${s.height}`}>
      <path d={s.d} fill={fill} />
    </svg>
  );
}

/**
 * Dedication card: "For {to}", their message, the song title and a
 * waveform. `og` is the 1200x630 link preview; `story` is the
 * 1080x1920 Instagram/WhatsApp-status export.
 */
export async function renderDedicationCard({
  variant,
  to,
  message,
  title,
  seed,
  linkText,
  undedicated = false,
  baseFonts = [],
}: {
  variant: DedicationVariant;
  to: string;
  message: string | null;
  title: string;
  seed: string;
  linkText?: string;
  /** Story export for a song with no dedication: no recipient block. */
  undedicated?: boolean;
  baseFonts?: CardFont[];
}) {
  const size = DEDICATION_SIZES[variant];
  const story = variant === "story";
  const pad = story ? 96 : 72;
  const inner = size.width - pad * 2;
  const toSize = story ? 120 : 72;
  const msgSize = story ? 56 : 38;
  const maxMsgLines = story ? 9 : 3;

  const toText = to;
  const toShaped = isIndicOnly(toText)
    ? await shapeLine(toText, toSize)
    : null;
  const msgShaped =
    message && isIndicOnly(message)
      ? await wrapShaped(message, msgSize, inner, maxMsgLines)
      : null;
  const titleShaped = isIndicOnly(title) ? await shapeLine(title, story ? 56 : 36) : null;

  // Anything not shaped falls back to text + the bundled script font.
  const needFallback = [
    !toShaped && detectScript(toText) !== "latin" ? toText : "",
    message && !msgShaped && detectScript(message) !== "latin" ? message : "",
    !titleShaped && detectScript(title) !== "latin" ? title : "",
  ].filter(Boolean);
  const fallbackText = needFallback.join("\n");
  const fonts = [
    ...(baseFonts.length ? baseFonts : [await loadLatinFont()]),
    ...(fallbackText ? await loadFontsFor(fallbackText) : []),
  ];
  const fam = (t: string) => `"${fontFamilyFor(t)}", system-ui, sans-serif`;
  const bars = waveformBars(seed, story ? 48 : 58);
  const barH = story ? 160 : 80;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: pad,
          background:
            "linear-gradient(160deg, #0a0612 0%, #1b0e2c 50%, #3a1a5e 100%)",
          color: "#fef7ea",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: story ? 30 : 22,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "rgba(254,247,234,0.55)",
          }}
        >
          {undedicated ? "neo-fm" : "neo-fm · a song for you"}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: story ? 36 : 18 }}>
          {undedicated ? null : (
          <div
            style={{
              display: "flex",
              fontSize: story ? 44 : 30,
              color: "#f0b35a",
              letterSpacing: 2,
            }}
          >
            Dedicated to
          </div>
          )}
          {undedicated ? null : toShaped ? (
            <Line s={toShaped} fill="#fef7ea" />
          ) : (
            <div
              style={{
                display: "flex",
                fontSize: toSize,
                lineHeight: 1.1,
                fontFamily: fam(toText),
              }}
            >
              {reorderForSatori(toText)}
            </div>
          )}
          {message ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: story ? 24 : 8,
                paddingLeft: 28,
                borderLeft: "4px solid #f0b35a",
                fontSize: msgSize,
                lineHeight: 1.35,
                color: "rgba(254,247,234,0.92)",
                fontFamily: fam(message),
              }}
            >
              {msgShaped
                ? msgShaped.map((l, i) => <Line key={i} s={l} fill="#fef7ea" />)
                : reorderForSatori(message)}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: story ? 40 : 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, height: barH }}>
            {bars.map((b, i) => (
              <div
                key={i}
                style={{
                  width: story ? 14 : 12,
                  height: Math.max(8, Math.round(b * barH)),
                  borderRadius: 6,
                  background: i % 5 === 0 ? "#f0b35a" : "rgba(240,179,90,0.55)",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {titleShaped ? (
              <Line s={titleShaped} fill="rgba(254,247,234,0.85)" />
            ) : (
              <div
                style={{
                  display: "flex",
                  fontSize: story ? 56 : 36,
                  color: "rgba(254,247,234,0.85)",
                  fontFamily: fam(title),
                }}
              >
                {reorderForSatori(title)}
              </div>
            )}
            {linkText ? (
              <div style={{ display: "flex", fontSize: story ? 30 : 22, color: "rgba(254,247,234,0.5)" }}>
                {linkText}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
