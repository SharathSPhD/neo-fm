"use client";

import Link from "next/link";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { MAX_MIX, WEIGHTS, setMixWeight, toggleMixLang, type MixPick, type MixWeight } from "@/lib/station/mix-picks";

const WEIGHT_LABEL = { 1: "station.mix.less", 2: "station.mix.even", 3: "station.mix.more" } as const;

/**
 * Station pass language mix: pick two or three languages and how much of each. "locked" shows one link to the pass instead
 * of the picker (flag on, listener without the perk). Written for 390px: chips wrap and each weight row stacks.
 */
export function StationMix({
  state,
  langs,
  picks,
  name,
  onChange,
}: {
  state: "on" | "locked";
  langs: readonly string[];
  picks: readonly MixPick[];
  name: (code: string) => string;
  onChange: (next: MixPick[]) => void;
}) {
  const { t } = useUiLang();
  if (state === "locked") {
    return (
      <Link href="/pricing" className="chip self-start" data-testid="mix-locked">
        {t("station.mix.locked")}
      </Link>
    );
  }
  return (
    <section aria-label={t("station.mix.title")} className="glass flex flex-col gap-3 rounded-2xl p-4" data-testid="station-mix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("station.mix.title")}</h3>
        {picks.length ? (
          <button type="button" onClick={() => onChange([])} className="text-xs underline">
            {t("station.mix.clear")}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-foreground/70">{t("station.mix.hint", { max: MAX_MIX })}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.mix.title")}>
        {langs.map((l) => (
          <button key={l} type="button" aria-pressed={picks.some((p) => p.lang === l)} onClick={() => onChange(toggleMixLang(picks, l))} className="chip">
            {name(l)}
          </button>
        ))}
      </div>
      {picks.length === 1 ? <p className="text-xs text-foreground/70">{t("station.mix.pickMore")}</p> : null}
      {picks.length >= 2 ? (
        <ul className="flex flex-col gap-2">
          {picks.map((p) => (
            <li key={p.lang} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">{name(p.lang)}</span>
              <div className="flex gap-1" role="radiogroup" aria-label={name(p.lang)}>
                {WEIGHTS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={p.weight === w}
                    onClick={() => onChange(setMixWeight(picks, p.lang, w as MixWeight))}
                    className="chip min-h-[44px] px-3 py-1 text-xs"
                    data-active={p.weight === w}
                  >
                    {t(WEIGHT_LABEL[w])}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
