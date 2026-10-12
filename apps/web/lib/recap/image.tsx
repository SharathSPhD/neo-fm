import React from "react";
import { ImageResponse } from "next/og";

import { UI_LANG_ENDONYM, isUiLang, type UiLang } from "@/lib/i18n/ui-strings";
import { prettyLanguage } from "@/lib/song/labels";
import { detectScript, fontFamilyFor, reorderForSatori, waveformBars, type CardFont } from "@/lib/share/card";
import { loadFontsFor, loadLatinFont, shapeLine, type ShapedLine } from "@/lib/share/shape";

import type { Recap } from "./compute";
import { moodLabel } from "./moods";
import { RECAP_STRINGS, monthLabel } from "./strings";

void React; // vitest compiles JSX with the classic runtime

export const RECAP_SIZE = { width: 1080, height: 1920 } as const;

const GOLD = "#f0b35a";
const CREAM = "#fef7ea";
const DIM = "rgba(254,247,234,0.6)";

const hasLatinLetters = (s: string) => /[A-Za-z]/.test(s);
const isIndicOnly = (s: string) => detectScript(s) !== "latin" && !hasLatinLetters(s);

interface Prepped {
  text: string;
  shaped: ShapedLine | null;
  size: number;
}

/** Indic-only text is drawn as HarfBuzz-shaped vector paths (satori can't shape conjuncts); the rest stays text. */
async function prep(text: string, size: number): Promise<Prepped> {
  return { text, size, shaped: isIndicOnly(text) ? await shapeLine(text, size) : null };
}

/** Shrinks a shaped line until it fits, so long titles never run off the card. */
async function prepFit(text: string, size: number, maxWidth: number): Promise<Prepped> {
  let p = await prep(text, size);
  for (let s = size; p.shaped && p.shaped.width > maxWidth && s > 28; s -= 6) p = await prep(text, s);
  return p;
}

function Txt({ p, color, weight }: { p: Prepped; color: string; weight?: number }) {
  if (p.shaped) {
    return (
      <svg width={p.shaped.width} height={p.shaped.height} viewBox={`0 0 ${p.shaped.width} ${p.shaped.height}`}>
        <path d={p.shaped.d} fill={color} />
      </svg>
    );
  }
  return (
    <div style={{ display: "flex", fontSize: p.size, color, lineHeight: 1.15, ...(weight ? { fontWeight: weight } : {}), fontFamily: `"${fontFamilyFor(p.text)}", system-ui, sans-serif` }}>
      {reorderForSatori(p.text)}
    </div>
  );
}

function langName(code: string): string {
  return isUiLang(code) ? UI_LANG_ENDONYM[code] : prettyLanguage(code);
}

function clip(t: string, max: number): string {
  const c = Array.from(t);
  return c.length <= max ? t : `${c.slice(0, max - 1).join("").trimEnd()}…`;
}

/** 1080x1920 story image for a month's recap, in the viewer's chosen UI language. */
export async function renderRecapStory({ recap, month, lang }: { recap: Recap; month: string; lang: UiLang }) {
  const S = RECAP_STRINGS[lang];
  const inner = RECAP_SIZE.width - 2 * 96;

  const title = await prepFit(S.title, 92, inner);
  const monthP = await prep(monthLabel(month, lang), 52);
  const songsLabel = await prep(S.songs, 44);
  const likesLabel = await prep(S.likes, 38);
  const listensLabel = await prep(S.listens, 38);
  const topLabel = await prep(S.topSong, 38);
  const topTitle = recap.topSong ? await prepFit(clip(recap.topSong.title, 48), 64, inner - 64) : null;
  const langsLabel = await prep(S.languages, 36);
  const langChips = await Promise.all(recap.languages.slice(0, 5).map(async (l) => ({ ...l, p: await prep(langName(l.code), 42) })));
  const moodsLabel = recap.moods.length ? await prep(S.moods, 36) : null;
  const moodChips = await Promise.all(recap.moods.slice(0, 4).map(async (m) => ({ ...m, p: await prep(moodLabel(m.mood, lang), 40) })));
  const collLabel = await prep(S.collections, 36);
  const emptyP = recap.songs === 0 ? await prepFit(S.empty, 56, inner) : null;

  const unshaped = [title, monthP, songsLabel, topTitle, ...langChips.map((c) => c.p), ...moodChips.map((c) => c.p)]
    .filter((p): p is Prepped => !!p && !p.shaped && detectScript(p.text) !== "latin")
    .map((p) => p.text)
    .join("\n");
  const fonts: CardFont[] = [await loadLatinFont()];
  if (unshaped) fonts.push(...(await loadFontsFor(unshaped)));
  const bars = waveformBars(`${month}:${recap.songs}`, 40);

  const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "32px 36px",
    borderRadius: 32,
    background: "rgba(254,247,234,0.07)",
    border: "2px solid rgba(240,179,90,0.25)",
    ...extra,
  });
  const big = (n: number, size: number) => (
    <div style={{ display: "flex", fontSize: size, lineHeight: 1, color: GOLD, fontWeight: 700 }}>{n.toLocaleString("en-IN")}</div>
  );
  const chip = (key: string, p: Prepped) => (
    <div key={key} style={{ display: "flex", padding: "14px 30px", borderRadius: 999, border: "2px solid rgba(240,179,90,0.5)", color: CREAM }}>
      <Txt p={p} color={CREAM} />
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
          padding: 96,
          background: "linear-gradient(160deg, #0a0612 0%, #1b0e2c 50%, #3a1a5e 100%)",
          color: CREAM,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 8, textTransform: "uppercase", color: DIM }}>neo-fm</div>
          <Txt p={title} color={CREAM} />
          <Txt p={monthP} color={GOLD} />
        </div>

        {emptyP ? (
          <div style={{ display: "flex" }}>
            <Txt p={emptyP} color={DIM} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={card({ flexDirection: "row", alignItems: "center", gap: 36 })}>
              {big(recap.songs, 190)}
              <Txt p={songsLabel} color={CREAM} />
            </div>

            <div style={{ display: "flex", gap: 28 }}>
              <div style={card({ flex: 1 })}>
                {big(recap.likes, 96)}
                <Txt p={likesLabel} color={DIM} />
              </div>
              <div style={card({ flex: 1 })}>
                {big(recap.listens, 96)}
                <Txt p={listensLabel} color={DIM} />
              </div>
            </div>

            {topTitle && recap.topSong ? (
              <div style={card({ gap: 18 })}>
                <Txt p={topLabel} color={GOLD} />
                <Txt p={topTitle} color={CREAM} />
                <div style={{ display: "flex", fontSize: 36, color: DIM }}>
                  {`♥ ${recap.topSong.likes} · ▶ ${recap.topSong.listens}`}
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Txt p={langsLabel} color={DIM} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>{langChips.map((c) => chip(c.code, c.p))}</div>
            </div>

            {moodsLabel ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Txt p={moodsLabel} color={DIM} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>{moodChips.map((c) => chip(c.mood, c.p))}</div>
              </div>
            ) : null}

            {recap.collections.created + recap.collections.added > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                {big(recap.collections.created, 64)}
                <Txt p={collLabel} color={DIM} />
              </div>
            ) : null}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 120 }}>
          {bars.map((b, i) => (
            <div key={i} style={{ width: 14, height: Math.max(8, Math.round(b * 120)), borderRadius: 6, background: i % 5 === 0 ? GOLD : "rgba(240,179,90,0.55)" }} />
          ))}
        </div>
      </div>
    ),
    { ...RECAP_SIZE, fonts },
  );
}
