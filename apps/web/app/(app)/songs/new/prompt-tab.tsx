"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";

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

type Language = "en" | "hi" | "kn" | "ta" | "bn" | "te" | "sa";
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

const PROMPT_MAX_CHARS = 500;

const EXAMPLE_PROMPTS: string[] = [
  "A melancholic Carnatic raga about the monsoon season and longing for home",
  "An energetic Bhangra-inspired folk song celebrating the harvest festival",
  "A devotional Sanskrit shloka invoking Saraswati, goddess of knowledge",
  "A soulful Hindi love song in the style of classic 1960s Bollywood",
  "A Kannada Bhavageete about the beauty of the Western Ghats at sunset",
];

export function PromptTab() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState("");
  const [styleFamily, setStyleFamily] = useState<StyleFamily>("carnatic");
  const [language, setLanguage] = useState<Language>("hi");
  const [duration, setDuration] = useState<Duration>(90);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Please describe your song first.");
      return;
    }

    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
      setError("Session expired. Please sign in again.");
      return;
    }

    setStatus("Sending to AI composer...");
    const res = await fetch("/api/songs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: trimmed,
        language,
        style_family: styleFamily,
        target_duration_seconds: duration,
      }),
    });

    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as
        | { reason?: string }
        | null;
      const reason = body?.reason ?? "quota";
      setError(
        reason === "storage_bytes"
          ? "You're over your storage quota for the month."
          : "You've hit your monthly song quota. Wait until next month or upgrade.",
      );
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      setError(`Server returned ${res.status}: ${body || "(no body)"}`);
      return;
    }

    setStatus("Queued. Redirecting to library...");
    startTransition(() => {
      router.replace("/library");
      router.refresh();
    });
  }

  function useExample() {
    const pick =
      EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)]!;
    setPrompt(pick);
  }

  const charsLeft = PROMPT_MAX_CHARS - prompt.length;
  const overCap = charsLeft < 0;

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="prompt"
            className="text-xs uppercase tracking-widest text-foreground/50"
          >
            Describe your song
          </label>
          <button
            type="button"
            onClick={useExample}
            className="text-[10px] text-accent/70 hover:text-accent transition"
          >
            use an example
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
          className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base leading-relaxed outline-none focus:border-accent resize-none"
        />
        <span
          className={
            overCap
              ? "text-[10px] text-red-300"
              : "text-[10px] text-foreground/40"
          }
        >
          {charsLeft} characters left
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
            Style
          </label>
          <select
            id="prompt-style"
            value={styleFamily}
            onChange={(e) => setStyleFamily(e.target.value as StyleFamily)}
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
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
            Language
          </label>
          <select
            id="prompt-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="prompt-duration"
            className="text-xs uppercase tracking-widest text-foreground/50"
          >
            Length
          </label>
          <select
            id="prompt-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) as Duration)}
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
          >
            {DURATION_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </div>
      </div>

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
        className="self-start rounded-md border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? "Queueing..." : "Describe & queue"}
      </button>
    </form>
  );
}
