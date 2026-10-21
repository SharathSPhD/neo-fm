import React from "react";
import { ImageResponse } from "next/og";

import { UI_LANG_ENDONYM, isUiLang, type UiLang } from "@/lib/i18n/ui-strings";
import { moodLabel } from "@/lib/recap/moods";
import { prettyLanguage } from "@/lib/song/labels";
import { detectScript, fontFamilyFor, reorderForSatori, waveformBars, type CardFont } from "@/lib/share/card";
import { loadFontsFor, loadLatinFont, shapeLine, type ShapedLine } from "@/lib/share/shape";

import type { Week } from "./week";
import { WEEK_STRINGS } from "./week-strings";

void React; // vitest compiles JSX with the classic runtime

export const WEEK_SIZE = { width: 1080, height: 1920 } as const;

const GOLD = "#f0b35a";
const CREAM = "#fef7ea";
const DIM = "rgba(254,247,234,0.6)";

const isIndicOnly = (s: string) => detectScript(s) !== "latin" && !/[A-Za-z]/.test(s);

interface Prepped {
  text: string;
  shaped: ShapedLine | null;
  size: number;
}

/** Indic-only text is drawn as HarfBuzz-shaped vector paths (satori can't shape conjuncts); the rest stays text. */
async function prep(text: string, size: number): Promise<Prepped> {
  return { text, size, shaped: isIndicOnly(text) ? await shapeLine(text, size) : null };
}

async function prepFit(text: string, size: number, maxWidth: number): Promise<Prepped> {
  let p = await prep(text, size);
  for (let s = size; p.shaped && p.shaped.width > maxWidth && s > 28; s -= 6) p = await prep(text, s);
  return p;
}

function Txt({ p, color }: { p: Prepped; color: string }) {
  if (p.shaped) {
    return (
      <svg width={p.shaped.width} height={p.shaped.height} viewBox={`0 0 ${p.shaped.width} ${p.shaped.height}`}>
        <path d={p.shaped.d} fill={color} />
      </svg>
    );
  }
  return (
    <div style={{ display: "flex", fontSize: p.size, color, lineHeight: 1.15, fontFamily: `"${fontFamilyFor(p.text)}", system-ui, sans-serif` }}>
      {reorderForSatori(p.text)}
    </div>
  );
}

const langName = (code: string) => (isUiLang(code) ? UI_LANG_ENDONYM[code] : prettyLanguage(code));

function clip(t: string, max: number): string {
  const c = Array.from(t);
  return c.length <= max ? t : `${c.slice(0, max - 1).join("").trimEnd()}…`;
}

/** 1080x1920 story image for "your week on neo-fm", in the viewer's chosen UI language. Built only from the caller's own week. */
export async function renderWeekStory({ week, lang }: { week: Week; lang: UiLang }) {
  const S = WEEK_STRINGS[lang];
  const inner = WEEK_SIZE.width - 2 * 96;

  const title = await prepFit(S.title, 88, inner);
  const minutesLabel = await prep(S.minutes, 44);
  const streakLabel = await prep(S.streak, 38);
  const daysLabel = await prep(S.days, 38);
  const favLabel = await prep(S.favourite, 38);
  const favTitle = week.favourite?.title ? await prepFit(clip(week.favourite.title, 48), 64, inner - 64) : null;
  const langsLabel = await prep(S.languages, 36);
  const langChips = await Promise.all(week.languages.slice(0, 4).map(async (l) => ({ code: l.language, p: await prep(langName(l.language), 42) })));
  const moodsLabel = week.moods.length ? await prep(S.moods, 36) : null;
  const moodChips = await Promise.all(week.moods.slice(0, 3).map(async (m) => ({ mood: m.mood, p: await prep(moodLabel(m.mood, lang), 40) })));
  const emptyP = week.empty ? await prepFit(S.empty, 56, inner) : null;

  const unshaped = [title, favTitle, ...langChips.map((c) => c.p), ...moodChips.map((c) => c.p)]
    .filter((p): p is Prepped => !!p && !p.shaped && detectScript(p.text) !== "latin")
    .map((p) => p.text)
    .join("\n");
  const fonts: CardFont[] = [await loadLatinFont()];
  if (unshaped) fonts.push(...(await loadFontsFor(unshaped)));
  const bars = waveformBars(`${week.start}:${week.minutes}`, 40);

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
        </div>

        {emptyP ? (
          <div style={{ display: "flex" }}>
            <Txt p={emptyP} color={DIM} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={card({ flexDirection: "row", alignItems: "center", gap: 36 })}>
              {big(week.minutes, 190)}
              <Txt p={minutesLabel} color={CREAM} />
            </div>

            <div style={{ display: "flex", gap: 28 }}>
              <div style={card({ flex: 1 })}>
                {big(week.streak, 96)}
                <Txt p={streakLabel} color={DIM} />
              </div>
              <div style={card({ flex: 1 })}>
                {big(week.activeDays, 96)}
                <Txt p={daysLabel} color={DIM} />
              </div>
            </div>

            {favTitle ? (
              <div style={card({ gap: 18 })}>
                <Txt p={favLabel} color={GOLD} />
                <Txt p={favTitle} color={CREAM} />
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
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 120 }}>
          {bars.map((b, i) => (
            <div key={i} style={{ width: 14, height: Math.max(8, Math.round(b * 120)), borderRadius: 6, background: i % 5 === 0 ? GOLD : "rgba(240,179,90,0.55)" }} />
          ))}
        </div>
      </div>
    ),
    { ...WEEK_SIZE, fonts },
  );
}
