"use client";

import { INTAKE_ENERGY, INTAKE_LANGS, INTAKE_MOODS, togglePick, type IntakeSelection } from "@/lib/station/intake";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { tasteLabel } from "@/lib/taste/labels";

/** `offered` is the station's own language list, so the intake never promises a language the station cannot play yet (English until its pool is deep enough).
 * Three rows of chips for the first-run intake (STATION_TASTE=1); the parent owns the selection and what happens on Start. */
export function StationIntake({ value, onChange, languageName, offered }: { value: IntakeSelection; onChange: (next: IntakeSelection) => void; languageName: (code: string) => string; offered: readonly string[] }) {
  const { t, lang } = useUiLang();
  const chip = (key: string, label: string, pressed: boolean, onClick: () => void) => (
    <button key={key} type="button" aria-pressed={pressed} onClick={onClick} className="chip">{label}</button>
  );
  return (
    <div className="flex flex-col gap-3" data-testid="station-intake">
      <p className="text-sm font-medium">{t("taste.title")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("station.lang.label")}>
        {INTAKE_LANGS.filter((l) => offered.includes(l)).map((l) => chip(`l-${l}`, languageName(l), value.languages.includes(l), () => onChange({ ...value, languages: togglePick(value.languages, l) })))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("taste.moods")}>
        {INTAKE_MOODS.map((m) => chip(`m-${m}`, tasteLabel(m, lang), value.moods.includes(m), () => onChange({ ...value, moods: togglePick(value.moods, m) })))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("taste.energy")}>
        {INTAKE_ENERGY.map((e) => chip(`e-${e}`, tasteLabel(e, lang), value.energy === e, () => onChange({ ...value, energy: value.energy === e ? null : e })))}
      </div>
    </div>
  );
}
