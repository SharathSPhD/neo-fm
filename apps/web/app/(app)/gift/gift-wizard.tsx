"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import {
  GIFT_DURATION_SECONDS,
  GIFT_LANGUAGES,
  GIFT_NOTE_MAX,
  OCCASIONS,
  RELATIONSHIPS,
  planGift,
  type GiftLanguage,
} from "@/lib/gift/occasions";
import { DEDICATION_TO_MAX } from "@/lib/share/dedication";

const LANGUAGE_NAME: Record<GiftLanguage, string> = {
  hi: "हिन्दी",
  ta: "தமிழ்",
  te: "తెలుగు",
  kn: "ಕನ್ನಡ",
  bn: "বাংলা",
};

const field = "rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent";
const label = "text-xs uppercase tracking-widest text-foreground/50";

export function GiftWizard({ initialOccasion }: { initialOccasion: string }) {
  const { t, lang } = useUiLang();
  const router = useRouter();
  const labelLang = lang === "en" ? "en" : lang;
  const [occasion, setOccasion] = useState(initialOccasion);
  const [relationship, setRelationship] = useState("friend");
  const [language, setLanguage] = useState<GiftLanguage>(lang !== "en" && (GIFT_LANGUAGES as readonly string[]).includes(lang) ? (lang as GiftLanguage) : "hi");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const planned = planGift({ occasion, relationship, language, name, note });
    if (!planned.ok) {
      setError(t("gift.errInput"));
      return;
    }
    const { plan } = planned;
    setBusy(true);
    try {
      const created = await fetch("/api/songs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: plan.prompt,
          language: plan.language,
          style_family: plan.styleFamily,
          target_duration_seconds: GIFT_DURATION_SECONDS,
        }),
      });
      if (created.status === 429) return setError(t("gift.errQuota"));
      if (created.status === 422) return setError(t("gift.errBlocked"));
      if (!created.ok) return setError(t("gift.errGeneric"));
      const { job_id: jobId } = (await created.json()) as { job_id: string };

      // The brief (including the note) was moderated above. The dedication route screens it again before it goes public.
      const ded = await fetch(`/api/songs/${jobId}/dedication`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: plan.to, message: plan.message }),
      });
      const q = new URLSearchParams({ occasion });
      // If only the dedication failed the song still renders; the gift page tells the user and links to the editor.
      if (!ded.ok) q.set("ded", "failed");
      router.replace(`/gift/${jobId}?${q.toString()}`);
    } catch {
      setError(t("gift.errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit}>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{t("gift.occasion")}</legend>
        <div className="flex flex-wrap gap-2">
          {OCCASIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={occasion === o.id}
              onClick={() => setOccasion(o.id)}
              className={`min-h-[44px] rounded-full border px-4 text-sm ${
                occasion === o.id ? "border-accent bg-accent/15 text-accent" : "border-muted/30 text-foreground/70 hover:border-accent/60"
              }`}
            >
              {o.label[labelLang]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="gift-name" className={label}>{t("gift.recipient")}</label>
        <input
          id="gift-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DEDICATION_TO_MAX}
          placeholder={t("gift.recipientPlaceholder")}
          className={field}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gift-rel" className={label}>{t("gift.relationship")}</label>
          <select id="gift-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} className={field}>
            {RELATIONSHIPS.map((r) => (
              <option key={r.id} value={r.id}>{r.label[labelLang]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gift-lang" className={label}>{t("gift.language")}</label>
          <select id="gift-lang" value={language} onChange={(e) => setLanguage(e.target.value as GiftLanguage)} className={field}>
            {GIFT_LANGUAGES.map((l) => (
              <option key={l} value={l}>{LANGUAGE_NAME[l]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="gift-note" className={label}>{t("gift.note")}</label>
        <textarea
          id="gift-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={GIFT_NOTE_MAX}
          rows={3}
          placeholder={t("gift.notePlaceholder")}
          className={field}
        />
      </div>

      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}

      <button
        type="submit"
        disabled={busy || name.trim().length === 0}
        className="min-h-[44px] rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? t("gift.making") : t("gift.submit")}
      </button>
    </form>
  );
}
