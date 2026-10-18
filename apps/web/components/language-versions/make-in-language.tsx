"use client";

/**
 * "Make it in another language": starts a NEW song in another language,
 * pre-filled with the original's theme, mood and style, and links it to
 * the original as a sibling version. Goes through POST /api/songs (prompt
 * branch + version_of), so quotas and moderation apply exactly as for any
 * new song.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { prettyLanguage } from "@/lib/song/labels";
import {
  availableTargets,
  buildVersionBrief,
  MAX_VERSION_BRIEF_CHARS,
  styleForVersion,
  type VersionLanguage,
} from "@/lib/song/language-version";

interface Props {
  songId: string;
  title: string;
  sourceLanguage: string;
  sourceStyle: string;
  durationSeconds: 30 | 60 | 90 | 180;
  /** The original's own brief; only passed for songs the viewer owns. */
  originalBrief?: string | null;
  /** Languages sibling versions already cover. */
  existingLanguages?: string[];
  signedIn?: boolean;
  nextPath?: string;
}

export function MakeInLanguageButton({
  songId,
  title,
  sourceLanguage,
  sourceStyle,
  durationSeconds,
  originalBrief,
  existingLanguages = [],
  signedIn = true,
  nextPath,
}: Props) {
  const router = useRouter();
  const targets = useMemo(
    () => availableTargets(sourceLanguage, existingLanguages),
    [sourceLanguage, existingLanguages],
  );
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<VersionLanguage | null>(targets[0] ?? null);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) return null;

  const brief =
    edited ??
    (target
      ? buildVersionBrief({ title, sourceLanguage, targetLanguage: target, sourceStyle, originalBrief })
      : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !brief.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/songs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: brief.trim(),
          language: target,
          style_family: styleForVersion(sourceStyle, target),
          target_duration_seconds: durationSeconds,
          version_of: songId,
        }),
      });
      if (res.status === 401) {
        setError("Sign in to make your own version.");
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          res.status === 422 && j.error === "content_policy"
            ? "That brief can't be used. Try different words."
            : res.status === 429
              ? "You've reached your song limit for now. Check your plan on the Account page."
              : "Couldn't start the new version. Please try again.",
        );
        return;
      }
      const { job_id } = (await res.json()) as { job_id: string };
      router.push(`/songs/${job_id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-muted/50 px-3 py-2 text-sm hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden>🌐</span> Make it in another language
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Make it in another language"
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-muted/40 bg-background p-4 shadow-xl"
        >
          {!signedIn ? (
            <p className="text-sm">
              <Link
                href={`/sign-in?next=${encodeURIComponent(nextPath ?? "/library")}`}
                className="text-accent underline underline-offset-4"
              >
                Sign in
              </Link>{" "}
              to make your own version of this song.
            </p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <fieldset className="flex flex-wrap gap-2">
                <legend className="mb-1 text-sm text-foreground/70">New language</legend>
                {targets.map((l) => (
                  <label
                    key={l}
                    lang={l}
                    className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm ${
                      target === l ? "border-accent bg-accent/10 text-accent" : "border-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="target-language"
                      className="sr-only"
                      checked={target === l}
                      onChange={() => {
                        setTarget(l);
                        setEdited(null);
                      }}
                    />
                    {prettyLanguage(l)}
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-foreground/70">Brief (edit if you like)</span>
                <textarea
                  value={brief}
                  onChange={(e) => setEdited(e.target.value)}
                  maxLength={MAX_VERSION_BRIEF_CHARS}
                  rows={6}
                  className="rounded-lg border border-muted/50 bg-transparent p-2"
                />
              </label>
              <p className="text-xs text-foreground/55">
                Creates a new song ({durationSeconds}s) that counts toward your plan. It&apos;s
                linked to this one so you can switch between versions.
              </p>
              <button
                type="submit"
                disabled={busy || !target || !brief.trim()}
                className="min-h-11 rounded-lg bg-accent px-4 text-background disabled:opacity-50"
              >
                {busy ? "Starting…" : `Make it in ${target ? prettyLanguage(target) : "…"}`}
              </button>
              {error ? (
                <p role="alert" className="text-xs text-red-400">
                  {error}
                </p>
              ) : null}
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
