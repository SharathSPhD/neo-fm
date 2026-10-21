"use client";

import { useState } from "react";

import { StationMix } from "@/app/(station)/station/station-mix";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import type { MixPick } from "@/lib/station/mix-picks";

const SAMPLE = ["kn", "hi", "en", "ta"] as const;
const NAME: Record<string, string> = { kn: "ಕನ್ನಡ", hi: "हिन्दी", en: "English", ta: "தமிழ்" };

/** The real mix picker on sample languages. Nothing is saved or sent: it is only here to show what the pass unlocks. */
export function PassPreview() {
  const { t } = useUiLang();
  const [picks, setPicks] = useState<MixPick[]>([
    { lang: "kn", weight: 3 },
    { lang: "hi", weight: 2 },
  ]);
  return (
    <div className="flex flex-col gap-2" data-testid="pass-preview">
      <StationMix state="on" langs={SAMPLE} picks={picks} name={(c) => NAME[c] ?? c} onChange={setPicks} />
      <p className="text-xs text-foreground/60">{t("passpage.preview.note")}</p>
    </div>
  );
}
