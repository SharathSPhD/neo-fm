"use client";

/**
 * v1.4 Sprint 3: shared overlay dialog for "Make a variation" and
 * "Make a remix". Both buttons render this component with a different
 * `kind` — the dialog adapts copy, default distance, and POST target.
 *
 * The overlay idiom mirrors `share-button.tsx` (full-screen scrim +
 * centred card). All controls map 1:1 to `ForkSongBody` in
 * `lib/song/fork.ts`; the server applies them via `applyForkToDoc` so
 * the dialog is the only place we have to teach about new fork knobs.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  DEFAULT_REMIX_DISTANCE,
  DEFAULT_VARIATION_DISTANCE,
  FORK_RAGA_SYSTEM_VALUES,
  type ForkRagaSystem,
  type ForkSongBody,
} from "@/lib/song/fork";

type Kind = "variation" | "remix";

export interface ForkSongDialogProps {
  songId: string;
  kind: Kind;
  /** Style of the source song — gates key/raga controls. */
  styleFamily: string;
  /** Optional list of section ids on the parent. Empty list disables the picker. */
  sections?: ReadonlyArray<{ id: string; type: string }>;
  /** "primary" (full button) or "subtle" (chip on /s/[publicId]). */
  variant?: "primary" | "subtle";
  /** Optional initial title override (defaults to "" so the user opts in). */
  initialTitle?: string;
  /** Optional initial raga override hint (defaults to inheriting the parent). */
  initialRaga?: { name: string; system: ForkRagaSystem };
}

const KIND_COPY: Record<
  Kind,
  {
    cta: string;
    submitting: string;
    title: string;
    blurb: string;
    distanceCopy: { close: string; far: string };
    distanceDefault: number;
  }
> = {
  variation: {
    cta: "Make a variation",
    submitting: "Generating…",
    title: "Make a variation",
    blurb:
      "A variation re-renders the same composition with the model's natural stochasticity. Tweak any control below; leave them empty for a faithful re-roll.",
    distanceCopy: { close: "Same composition", far: "Looser interpretation" },
    distanceDefault: DEFAULT_VARIATION_DISTANCE,
  },
  remix: {
    cta: "Make a remix",
    submitting: "Forking…",
    title: "Make a remix",
    blurb:
      "A remix forks the song with creative pivots. Override tempo, key, or raga; pick a subset of sections to regenerate.",
    distanceCopy: { close: "Recognisable", far: "Bold reinterpretation" },
    distanceDefault: DEFAULT_REMIX_DISTANCE,
  },
};

function endpoint(kind: Kind, songId: string): string {
  return `/api/songs/${songId}/${kind}`;
}

const WESTERN_STYLES = new Set(["western", "bollywood-ballad"]);

function ragaSystemsForStyle(style: string): readonly ForkRagaSystem[] {
  switch (style) {
    case "carnatic":
    case "telugu-keerthana":
    case "sanskrit-shloka":
      return ["carnatic"];
    case "hindustani":
      return ["hindustani"];
    case "kannada-light-classical":
      return ["light-classical", "carnatic"];
    case "kannada-folk":
    case "tamil-folk":
      return ["folk"];
    case "bengali-rabindrasangeet":
      return ["hindustani", "light-classical"];
    default:
      return [];
  }
}

export function ForkSongDialog({
  songId,
  kind,
  styleFamily,
  sections,
  variant = "primary",
  initialTitle = "",
  initialRaga,
}: ForkSongDialogProps) {
  const router = useRouter();
  const copy = KIND_COPY[kind];

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [distance, setDistance] = useState<number>(copy.distanceDefault);
  const [tempoBpm, setTempoBpm] = useState<string>("");
  const [keyOverride, setKeyOverride] = useState<string>("");
  const [ragaName, setRagaName] = useState<string>(initialRaga?.name ?? "");
  const [ragaSystem, setRagaSystem] = useState<ForkRagaSystem | "">(
    initialRaga?.system ?? "",
  );
  const [voiceId, setVoiceId] = useState<string>("");
  const [selectedSections, setSelectedSections] = useState<Set<string>>(
    new Set(),
  );
  const [title, setTitle] = useState<string>(initialTitle);

  const allowedRagaSystems = useMemo(
    () => ragaSystemsForStyle(styleFamily),
    [styleFamily],
  );
  const supportsKey = WESTERN_STYLES.has(styleFamily);
  const supportsRaga = allowedRagaSystems.length > 0;

  function reset() {
    setDistance(copy.distanceDefault);
    setTempoBpm("");
    setKeyOverride("");
    setRagaName(initialRaga?.name ?? "");
    setRagaSystem(initialRaga?.system ?? "");
    setVoiceId("");
    setSelectedSections(new Set());
    setTitle(initialTitle);
    setError(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function toggleSection(id: string) {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildBody(): ForkSongBody {
    const body: ForkSongBody = {};
    if (distance !== copy.distanceDefault) body.distance = distance;
    if (tempoBpm.trim().length > 0) {
      const n = Number.parseInt(tempoBpm, 10);
      if (Number.isFinite(n)) body.tempo_bpm = n;
    }
    if (supportsKey && keyOverride.trim().length > 0) {
      body.key_override = keyOverride.trim();
    }
    if (supportsRaga && ragaName.trim().length > 0 && ragaSystem !== "") {
      body.raga_override = { name: ragaName.trim(), system: ragaSystem };
    }
    if (voiceId.trim().length > 0) body.voice_id = voiceId.trim();
    if (selectedSections.size > 0) {
      body.section_ids = Array.from(selectedSections);
    }
    if (title.trim().length > 0) body.title = title.trim();
    return body;
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const body = buildBody();
      const res = await fetch(endpoint(kind, songId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push(`/sign-in?next=/songs/${songId}`);
        return;
      }
      if (res.status === 429) {
        setError(
          "You've hit your monthly quota. Free tier is 3 songs / month.",
        );
        return;
      }
      if (res.status === 422) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError(
          data.message ?? data.error ?? `Couldn't apply the ${kind} overrides.`,
        );
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: unknown;
        };
        setError(
          typeof data.details === "string"
            ? data.details
            : data.error ?? `Couldn't kick off the ${kind}.`,
        );
        return;
      }
      const payload = (await res.json()) as { job_id: string };
      router.push(`/songs/${payload.job_id}`);
    });
  }

  const triggerClass =
    variant === "primary"
      ? "rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      : "rounded-full border border-muted/40 px-3 py-1.5 text-xs text-foreground/75 transition hover:border-accent/40 hover:text-foreground disabled:opacity-50";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className={triggerClass}
      >
        {pending ? copy.submitting : copy.cta}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <div
            className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-muted/30 bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-medium tracking-tight">
                {copy.title}
              </h2>
              <button
                type="button"
                onClick={close}
                className="text-foreground/40 hover:text-foreground/80"
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <p className="text-xs text-foreground/60">{copy.blurb}</p>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-[10px] uppercase tracking-widest text-foreground/40">
                Distance
              </legend>
              <input
                aria-label="Distance from the original"
                type="range"
                min={0}
                max={100}
                step={1}
                value={distance}
                onChange={(e) => setDistance(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-[10px] text-foreground/40">
                <span>{copy.distanceCopy.close}</span>
                <span>{distance}</span>
                <span>{copy.distanceCopy.far}</span>
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                  Tempo (BPM)
                </span>
                <input
                  type="number"
                  min={30}
                  max={240}
                  inputMode="numeric"
                  value={tempoBpm}
                  onChange={(e) => setTempoBpm(e.target.value)}
                  placeholder="(inherit)"
                  className="rounded-md border border-muted/30 bg-muted/10 px-2 py-1 font-mono text-xs"
                />
              </label>

              {supportsKey ? (
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                    Key
                  </span>
                  <input
                    type="text"
                    maxLength={8}
                    value={keyOverride}
                    onChange={(e) => setKeyOverride(e.target.value)}
                    placeholder="(inherit, e.g. F#m)"
                    className="rounded-md border border-muted/30 bg-muted/10 px-2 py-1 font-mono text-xs"
                  />
                </label>
              ) : (
                <div className="flex flex-col gap-1 text-xs opacity-50">
                  <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                    Key
                  </span>
                  <p className="rounded-md border border-muted/20 bg-muted/5 px-2 py-1 font-mono text-[10px] text-foreground/40">
                    Western-only
                  </p>
                </div>
              )}
            </div>

            {supportsRaga ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-[10px] uppercase tracking-widest text-foreground/40">
                  Raga
                </legend>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <input
                    type="text"
                    maxLength={64}
                    value={ragaName}
                    onChange={(e) => setRagaName(e.target.value)}
                    placeholder="raga name"
                    className="col-span-2 rounded-md border border-muted/30 bg-muted/10 px-2 py-1 font-mono text-xs"
                  />
                  <select
                    value={ragaSystem}
                    onChange={(e) =>
                      setRagaSystem(e.target.value as ForkRagaSystem | "")
                    }
                    className="rounded-md border border-muted/30 bg-muted/10 px-2 py-1 text-xs"
                  >
                    <option value="">(system)</option>
                    {FORK_RAGA_SYSTEM_VALUES.filter((s) =>
                      allowedRagaSystems.includes(s),
                    ).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </fieldset>
            ) : null}

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                Voice
              </span>
              <input
                type="text"
                maxLength={64}
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="(inherit, e.g. kn-female-warm-01)"
                className="rounded-md border border-muted/30 bg-muted/10 px-2 py-1 font-mono text-xs"
              />
            </label>

            {sections && sections.length > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-[10px] uppercase tracking-widest text-foreground/40">
                  Sections to regenerate
                </legend>
                <p className="text-[10px] text-foreground/40">
                  Empty = regenerate everything.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sections.map((s) => {
                    const active = selectedSections.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSection(s.id)}
                        className={`rounded-full border px-2 py-1 text-[11px] transition ${
                          active
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-muted/30 text-foreground/70 hover:border-accent/30"
                        }`}
                      >
                        {s.type}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[10px] uppercase tracking-widest text-foreground/40">
                Title
              </span>
              <input
                type="text"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="(inherit)"
                className="rounded-md border border-muted/30 bg-muted/10 px-2 py-1 text-xs"
              />
            </label>

            {error ? (
              <p
                role="alert"
                className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300"
              >
                {error}
              </p>
            ) : null}

            <footer className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-md border border-muted/30 px-3 py-1.5 text-xs text-foreground/70 hover:bg-muted/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {pending ? copy.submitting : copy.cta}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
