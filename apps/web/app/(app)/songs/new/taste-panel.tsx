"use client";

import { useEffect, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { tasteLabel } from "@/lib/taste/labels";
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

function Chips({ label, options, value, onChange, show }: { show: (token: string) => string; label: string; options: readonly string[]; value: readonly string[]; onChange: (next: string[]) => void }) {
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
              {show(o)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Select({ label, value, onChange, options, show }: { show: (token: string) => string; label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs uppercase tracking-widest text-foreground/50">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2 text-sm normal-case tracking-normal text-foreground outline-hidden focus:border-accent">
        <option value="">-</option>
        {options.map((o) => <option key={o} value={o}>{show(o)}</option>)}
      </select>
    </label>
  );
}

/**
 * Optional taste questions under the prompt. Reports a normalised brief (or undefined when nothing is chosen) on every
 * change, and remembers the last choice in this browser only, so the next song starts from it.
 */
export function TastePanel({ onChange }: { onChange: (taste: TasteBrief | undefined) => void }) {
  const { t, lang } = useUiLang();
  const show = (token: string) => tasteLabel(token, lang);
  const [genres, setGenres] = useState<string[]>([]);
  const [moods, setMoods] = useState<string[]>([]);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [eras, setEras] = useState<string[]>([]);
  const [register, setRegister] = useState("");
  const [setting, setSetting] = useState("");
  const [energy, setEnergy] = useState("");
  const [background, setBackground] = useState("");

  const [note, setNote] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(true);

  function apply(saved: TasteBrief) {
    setGenres(saved.genres ?? []);
    setMoods(saved.moods ?? []);
    setInstruments(saved.instruments ?? []);
    setEras(saved.eras ?? []);
    setRegister(saved.register ?? "");
    setSetting(saved.setting ?? "");
    setEnergy(saved.energy ?? "");
    setBackground(saved.background ?? "");
  }

  // The saved profile wins; this browser's last choice fills in first, and stays when saving is not available yet.
  useEffect(() => {
    try {
      const local = normaliseTaste(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
      if (local) apply(local);
    } catch {
      // storage blocked or unreadable: start empty
    }
    fetch("/api/me/taste/stated")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { taste?: unknown; available?: boolean } | null) => {
        if (!j) return;
        if (j.available === false) setCanSave(false);
        const saved = normaliseTaste(j.taste);
        if (saved) apply(saved);
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    const taste = normaliseTaste({ v: 1, genres, moods, instruments, eras, register: register || undefined, setting: setting || undefined, energy: energy || undefined, background });
    if (!taste) return;
    const res = await fetch("/api/me/taste/stated", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ taste }) }).catch(() => null);
    setNote(res?.ok ? t("taste.saved") : res?.status === 403 ? t("taste.consentNeeded") : t("taste.saveFailed"));
  }

  async function forget() {
    await fetch("/api/me/taste/stated", { method: "DELETE" }).catch(() => null);
    setGenres([]); setMoods([]); setInstruments([]); setEras([]); setRegister(""); setSetting(""); setEnergy(""); setBackground("");
    setNote(null);
  }

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
        <Chips show={show} label={t("taste.genres")} options={TASTE_GENRES} value={genres} onChange={setGenres} />
        <Chips show={show} label={t("taste.moods")} options={TASTE_MOODS} value={moods} onChange={setMoods} />
        <Chips show={show} label={t("taste.instruments")} options={TASTE_INSTRUMENTS} value={instruments} onChange={setInstruments} />
        <Chips show={show} label={t("taste.era")} options={TASTE_ERAS} value={eras} onChange={setEras} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select show={show} label={t("taste.energy")} value={energy} onChange={setEnergy} options={TASTE_ENERGY} />
          <Select show={show} label={t("taste.register")} value={register} onChange={setRegister} options={TASTE_REGISTERS} />
          <Select show={show} label={t("taste.setting")} value={setting} onChange={setSetting} options={TASTE_SETTINGS} />
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
        {canSave ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} className="min-h-[36px] rounded-md border border-accent/40 bg-accent/10 px-3 text-xs font-medium text-accent hover:bg-accent/20">{t("taste.save")}</button>
            <button type="button" onClick={forget} className="min-h-[36px] px-2 text-xs text-foreground/60 underline hover:text-foreground">{t("taste.forget")}</button>
            {note ? <span role="status" className="text-xs text-foreground/70">{note}</span> : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
