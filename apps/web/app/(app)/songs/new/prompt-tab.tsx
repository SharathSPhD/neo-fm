"use client";

import type { Language } from "@neo-fm/song-doc";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { EXAMPLE_IDEAS } from "@/lib/first-run/examples";
import { isUiLang, type UiKey } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { policyErrorMessage } from "@/lib/safety/client-message";
import { createBrowserSupabase } from "@/lib/supabase/client";

import { duetHeld, type VoiceChoice } from "@/lib/voice";

import { FirstRunGuide } from "./first-run-guide";

type StyleFamily =
  | "western"
  | "carnatic"
  | "hindustani"
  | "kannada-folk"
  | "kannada-light-classical"
  | "tamil-folk"
  | "bollywood-ballad"
  | "sanskrit-shloka"
  | "bengali-rabindrasangeet"
  | "telugu-keerthana";

type Duration = 30 | 60 | 90 | 180;

const STYLE_OPTIONS: { value: StyleFamily; label: string }[] = [
  { value: "carnatic", label: "Carnatic" },
  { value: "hindustani", label: "Hindustani" },
  { value: "kannada-light-classical", label: "Kannada light-classical" },
  { value: "kannada-folk", label: "Kannada folk" },
  { value: "tamil-folk", label: "Tamil folk" },
  { value: "bollywood-ballad", label: "Bollywood ballad" },
  { value: "bengali-rabindrasangeet", label: "Bengali Rabindrasangeet" },
  { value: "telugu-keerthana", label: "Telugu keerthana" },
  { value: "sanskrit-shloka", label: "Sanskrit shloka" },
  { value: "western", label: "Western" },
];

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "hi", label: "Hindi" },
  { value: "kn", label: "Kannada" },
  { value: "ta", label: "Tamil" },
  { value: "bn", label: "Bengali" },
  { value: "te", label: "Telugu" },
  { value: "sa", label: "Sanskrit" },
  { value: "en", label: "English" },
];

const DURATION_OPTIONS: Duration[] = [30, 60, 90, 180];

/** The style that best fits each language, applied until the listener picks a style themselves. */
const DEFAULT_STYLE: Record<Language, StyleFamily> = {
  hi: "bollywood-ballad", kn: "kannada-light-classical", ta: "tamil-folk", te: "telugu-keerthana",
  bn: "bengali-rabindrasangeet", sa: "sanskrit-shloka", en: "western",
  // Expansion languages have no style family of their own yet; these are the closest existing ones (placeholder until
  // the council's per-language genres become style presets).
  mr: "bollywood-ballad", pa: "bollywood-ballad", gu: "bollywood-ballad", bho: "bollywood-ballad",
  ml: "carnatic", or: "hindustani", ur: "hindustani", as: "hindustani",
};

const PROMPT_MAX_CHARS = 500;

const VOICE_LABEL_KEY = {
  station: "prompt.voiceAuto", female: "prompt.voiceFemale", male: "prompt.voiceMale", duet: "prompt.voiceDuet",
} as const satisfies Record<VoiceChoice, UiKey>;

const GUIDE_DISMISSED_KEY = "neo-fm:first-run-dismissed";

export function PromptTab({ showGuide = false, initialIdea, extraLanguages = [], voiceChoices }: { voiceChoices?: readonly VoiceChoice[]; showGuide?: boolean; extraLanguages?: { code: Language; name: string }[]; initialIdea?: { prompt: string; language: Language } }) {
  const router = useRouter();
  const { t, lang: uiLang } = useUiLang();
  // An idea chosen on /ideas pre-fills the box and skips the first-run guide (the choice is already made).
  const [guideOpen, setGuideOpen] = useState(showGuide && !initialIdea);
  const [pending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState(initialIdea?.prompt ?? "");
  const [styleFamily, setStyleFamily] = useState<StyleFamily>(DEFAULT_STYLE[initialIdea?.language ?? "hi"]);
  const [styleTouched, setStyleTouched] = useState(false);
  const [language, setLanguage] = useState<Language>(initialIdea?.language ?? "hi");
  const [duration, setDuration] = useState<Duration>(30);
  const [voice, setVoice] = useState<VoiceChoice>("station");
  const shownVoices = voiceChoices?.filter((c) => !(c === "duet" && duetHeld(language)));
  const voiceNow: VoiceChoice = shownVoices?.includes(voice) ? voice : "station";
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!showGuide) return;
    try {
      if (window.localStorage.getItem(GUIDE_DISMISSED_KEY)) setGuideOpen(false);
    } catch {
      // storage blocked: keep the guide visible
    }
  }, [showGuide]);

  // Seed the song language from the saved UI language the first time the
  // guide mounts, so a returning visitor who chose Tamil lands on Tamil.
  useEffect(() => {
    if (showGuide && !initialIdea && isUiLang(uiLang) && uiLang !== "en") {
      setLanguage(uiLang);
      if (!styleTouched) setStyleFamily(DEFAULT_STYLE[uiLang]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  function dismissGuide() {
    setGuideOpen(false);
    try {
      window.localStorage.setItem(GUIDE_DISMISSED_KEY, "1");
    } catch {
      // best effort
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    const trimmed = prompt.trim();
    if (!trimmed) {
      setError(t("prompt.errEmpty"));
      return;
    }

    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
      setError(t("prompt.errSession"));
      return;
    }

    setStatus(t("prompt.sending"));
    const res = await fetch("/api/songs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: trimmed,
        language,
        style_family: styleFamily,
        target_duration_seconds: duration,
        ...(voiceNow !== "station" ? { voice: { choice: voiceNow } } : {}),
      }),
    });

    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as
        | { reason?: string }
        | null;
      const reason = body?.reason ?? "quota";
      setStatus(null);
      setError(
        reason === "storage_bytes" ? t("prompt.errStorage") : t("prompt.errQuota"),
      );
      return;
    }
    const policy = await policyErrorMessage(res, t);
    if (policy) {
      setStatus(null);
      setError(policy);
      return;
    }
    if (!res.ok) {
      setStatus(null);
      setError(t("prompt.errServer"));
      return;
    }

    setStatus(t("prompt.queued"));
    startTransition(() => {
      router.replace("/library");
      // No router.refresh() here: in Next 15 it cancels the replace above; navigating to a dynamic page refetches anyway.
    });
  }

  function useExample() {
    const pool = EXAMPLE_IDEAS[isUiLang(language) ? language : "en"];
    setPrompt(pool[Math.floor(Math.random() * pool.length)]!);
  }

  const charsLeft = PROMPT_MAX_CHARS - prompt.length;
  const overCap = charsLeft < 0;

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit}>
      {guideOpen ? (
        <FirstRunGuide
          language={isUiLang(language) ? language : "hi"}
          onPickLanguage={(l) => {
            setLanguage(l);
            if (!styleTouched) setStyleFamily(DEFAULT_STYLE[l]);
          }}
          onPickIdea={(p) => setPrompt(p)}
          onSkip={dismissGuide}
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="prompt"
            className="text-xs uppercase tracking-widest text-foreground/50"
          >
            {t("prompt.describe")}
          </label>
          <button
            type="button"
            onClick={useExample}
            className="min-h-[44px] px-2 text-xs text-accent hover:underline"
          >
            {t("prompt.useExample")}
          </button>
        </div>
        <textarea
          id="prompt"
          name="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={PROMPT_MAX_CHARS + 50}
          rows={5}
          placeholder="e.g. A melancholic Carnatic raga about the monsoon season and longing for home, with a female vocalist in the Kalyani raga, 90 seconds long"
          className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base leading-relaxed outline-hidden focus:border-accent resize-none"
          lang={language}
        />
        <span
          className={
            overCap
              ? "text-[10px] text-red-300"
              : "text-[10px] text-foreground/40"
          }
        >
          {charsLeft} {t("prompt.charsLeft")}
        </span>
      </div>

      <p className="text-xs text-foreground/50 leading-relaxed -mt-3">
        The AI will build the full song structure — raga, tala, lyrics, and
        voice — from your description. You can still pick style, language, and
        length below.
      </p>

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="prompt-style"
            className="text-xs uppercase tracking-widest text-foreground/50"
          >
            {t("prompt.style")}
          </label>
          <select
            id="prompt-style"
            value={styleFamily}
            onChange={(e) => { setStyleTouched(true); setStyleFamily(e.target.value as StyleFamily); }}
            className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-hidden focus:border-accent"
          >
            {STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="prompt-language"
            className="text-xs uppercase tracking-widest text-foreground/50"
          >
            {t("prompt.language")}
          </label>
          <select
            id="prompt-language"
            value={language}
            onChange={(e) => { const l = e.target.value as Language; setLanguage(l); if (!styleTouched) setStyleFamily(DEFAULT_STYLE[l]); }}
            className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-hidden focus:border-accent"
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {extraLanguages.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="prompt-duration"
            className="text-xs uppercase tracking-widest text-foreground/50"
          >
            {t("prompt.length")}
          </label>
          <select
            id="prompt-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) as Duration)}
            className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-hidden focus:border-accent"
          >
            {DURATION_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} {t("prompt.seconds")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {voiceChoices ? (
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <label htmlFor="prompt-voice" className="text-xs uppercase tracking-widest text-foreground/50">
            {t("prompt.voice")}
          </label>
          <select
            id="prompt-voice"
            value={voiceNow}
            disabled={voiceChoices.length <= 1}
            onChange={(e) => setVoice(e.target.value as VoiceChoice)}
            className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-hidden focus:border-accent disabled:opacity-60"
          >
            {(shownVoices ?? voiceChoices).map((c) => (
              <option key={c} value={c}>
                {t(VOICE_LABEL_KEY[c])}
              </option>
            ))}
          </select>
          {voiceChoices.length <= 1 ? <p className="text-xs text-foreground/50">{t("prompt.voiceUpgrade")}</p> : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-accent">
          {status}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || overCap || prompt.trim().length === 0}
        className="min-h-[44px] w-full rounded-md border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50 sm:w-auto sm:self-start"
      >
        {pending ? t("prompt.queueing") : t("prompt.submit")}
      </button>
    </form>
  );
}
