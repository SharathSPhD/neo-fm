"use client";

import { useEffect, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import {
  BACKGROUND_MAX_CHARS,
  TASTE_ENERGY,
  TASTE_ERAS,
  TASTE_REGISTERS,
  TASTE_SETTINGS,
  TASTE_GENRES,
  TASTE_INSTRUMENTS,
  TASTE_MOODS,
  normaliseTaste,
  type TasteBrief,
} from "@/lib/taste/brief";

const STORAGE_KEY = "neo-fm:taste-brief";
const MAX_PICKS = 4;

function Chips({ label, options, value, onChange }: { label: string; options: readonly string[]; value: readonly string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs uppercase tracking-widest text-foreground/50">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={!on && value.length >= MAX_PICKS}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={[
                "min-h-[36px] rounded-full border px-3 text-xs transition disabled:opacity-40",
                on ? "border-accent bg-accent/15 text-accent" : "border-foreground/15 text-foreground/70 hover:border-foreground/30",
              ].join(" ")}
            >
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs uppercase tracking-widest text-foreground/50">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2 text-sm normal-case tracking-normal text-foreground outline-hidden focus:border-accent">
        <option value="">-</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/**
 * Optional taste questions under the prompt. Reports a normalised brief (or undefined when nothing is chosen) on every
 * change, and remembers the last choice in this browser only, so the next song starts from it.
 */
export function TastePanel({ onChange }: { onChange: (taste: TasteBrief | undefined) => void }) {
  const { t } = useUiLang();
  const [genres, setGenres] = useState<string[]>([]);
  const [moods, setMoods] = useState<string[]>([]);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [eras, setEras] = useState<string[]>([]);
  const [register, setRegister] = useState("");
  const [setting, setSetting] = useState("");
  const [energy, setEnergy] = useState("");
  const [background, setBackground] = useState("");

  useEffect(() => {
    try {
      const saved = normaliseTaste(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
      if (!saved) return;
      setGenres(saved.genres ?? []);
      setMoods(saved.moods ?? []);
      setInstruments(saved.instruments ?? []);
      setEras(saved.eras ?? []);
      setRegister(saved.register ?? "");
      setSetting(saved.setting ?? "");
      setEnergy(saved.energy ?? "");
      setBackground(saved.background ?? "");
    } catch {
      // storage blocked or unreadable: start empty
    }
  }, []);

  useEffect(() => {
    const taste = normaliseTaste({ v: 1, genres, moods, instruments, eras, register: register || undefined, setting: setting || undefined, energy: energy || undefined, background });
    onChange(taste ?? undefined);
    try {
      if (taste) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(taste));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // best effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a state setter
  }, [genres, moods, instruments, eras, register, setting, energy, background]);

  return (
    <details className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("taste.title")}</summary>
      <div className="mt-4 flex flex-col gap-5">
        <p className="text-xs text-foreground/50 leading-relaxed">{t("taste.hint")}</p>
        <Chips label={t("taste.genres")} options={TASTE_GENRES} value={genres} onChange={setGenres} />
        <Chips label={t("taste.moods")} options={TASTE_MOODS} value={moods} onChange={setMoods} />
        <Chips label={t("taste.instruments")} options={TASTE_INSTRUMENTS} value={instruments} onChange={setInstruments} />
        <Chips label={t("taste.era")} options={TASTE_ERAS} value={eras} onChange={setEras} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label={t("taste.energy")} value={energy} onChange={setEnergy} options={TASTE_ENERGY} />
          <Select label={t("taste.register")} value={register} onChange={setRegister} options={TASTE_REGISTERS} />
          <Select label={t("taste.setting")} value={setting} onChange={setSetting} options={TASTE_SETTINGS} />
        </div>
        <label className="flex flex-col gap-1.5 text-xs uppercase tracking-widest text-foreground/50">
          {t("taste.background")}
          <textarea
            value={background}
            maxLength={BACKGROUND_MAX_CHARS}
            rows={2}
            onChange={(e) => setBackground(e.target.value)}
            placeholder={t("taste.backgroundPh")}
            className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base normal-case tracking-normal text-foreground outline-hidden focus:border-accent resize-none"
          />
        </label>
      </div>
    </details>
  );
}
