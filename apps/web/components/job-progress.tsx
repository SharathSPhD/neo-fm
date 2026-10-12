"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatDuration, type JobStage } from "@/lib/progress/job-progress";
import { translate, type UiKey, type UiVars } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

type Stage = JobStage;
type Eta = { n: number; p50_s: number; p90_s: number };

const STEPS: { key: Stage[]; label: UiKey; hint: UiKey }[] = [
  { key: ["queued", "starting"], label: "job.warming", hint: "job.warmingHint" },
  { key: ["writing"], label: "job.writing", hint: "job.writingHint" },
  { key: ["polishing"], label: "job.polishing", hint: "job.polishingHint" },
  { key: ["singing"], label: "job.singing", hint: "job.singingHint" },
  { key: ["finishing", "done"], label: "job.checking", hint: "job.checkingHint" },
];

/**
 * Drives the job: polling /api/songs/{id} is what advances an unfinished job server-side (pull-based worker),
 * so this component must be mounted while a song is queued/processing. Refreshes the page when it finishes.
 * Read-only on job state: it shows the stage, the lyrics as soon as they are ready, and a typical-time estimate.
 */
export function JobProgress({ songId, initialStage = "queued", createdAt }: { songId: string; initialStage?: Stage; createdAt?: string }) {
  const router = useRouter();
  const { t } = useUiLang();
  const [stage, setStage] = useState<Stage>(initialStage);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [eta, setEta] = useState<Eta | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const t0 = createdAt && Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : Date.now();
    const tick = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - t0) / 1000))), 1000);
    let timer: ReturnType<typeof setTimeout>;
    let delay = 3000;
    const poll = async () => {
      if (done.current) return;
      try {
        const res = await fetch(`/api/songs/${encodeURIComponent(songId)}`, { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as { status: string; stage?: Stage; error?: string | null; lyrics?: string; eta?: Eta | null };
          if (j.stage) setStage(j.stage);
          if (j.lyrics) setLyrics(j.lyrics);
          if (j.eta) setEta(j.eta);
          if (j.status === "completed" || j.status === "failed") {
            done.current = true;
            if (j.status === "failed") setError(friendlyJobError(j.error, t));
            router.refresh();
            return;
          }
          delay = 3000;
        } else delay = Math.min(delay * 1.5, 15000);
      } catch {
        delay = Math.min(delay * 1.5, 15000);
      }
      timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { done.current = true; clearInterval(tick); clearTimeout(timer); };
  }, [songId, router, createdAt, t]);

  const current = Math.max(0, STEPS.findIndex((s) => s.key.includes(stage)));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const etaLine = eta
    ? elapsed <= eta.p90_s
      ? t("job.etaUsual", { p50: formatDuration(eta.p50_s), p90: formatDuration(eta.p90_s) })
      : t("job.etaLonger")
    : t("job.etaDefault");
  return (
    <section data-testid="job-progress" aria-live="polite" className="rounded-lg border border-muted/20 bg-muted/5 p-5">
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.label} className="flex items-start gap-3">
              <span
                aria-hidden
                className={
                  "mt-1 h-2.5 w-2.5 shrink-0 rounded-full " +
                  (state === "done" ? "bg-accent" : state === "active" ? "animate-pulse bg-accent" : "bg-muted/40")
                }
              />
              <div className={state === "todo" ? "opacity-50" : ""}>
                <p className="text-sm font-medium">{t(s.label)}</p>
                {state === "active" ? <p className="text-xs text-foreground/60">{t(s.hint)}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {lyrics ? (
        <div data-testid="job-progress-lyrics" className="mt-4 rounded-md border border-muted/20 bg-background/40 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground/50">{t("job.yourLyrics")}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{lyrics}</pre>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-foreground/50">
        {error ?? t("job.status", { clock, eta: etaLine })}
      </p>
    </section>
  );
}

const FRIENDLY: Record<string, UiKey> = {
  allowance_reached: "job.err.allowance",
  render_failed: "job.err.render",
  timed_out: "job.err.timeout",
  content_policy: "job.err.policy",
};

type Translate = (key: UiKey, vars?: UiVars) => string;

/** `t` defaults to English so non-React callers (and tests) keep working. */
export function friendlyJobError(code?: string | null, t: Translate = (k, v) => translate("en", k, v)): string {
  return t((code && FRIENDLY[code]) || "job.err.generic");
}
