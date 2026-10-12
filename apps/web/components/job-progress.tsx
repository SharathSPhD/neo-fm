"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { translate, type UiKey, type UiVars } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

type Stage = "queued" | "starting" | "writing" | "rendering" | "finishing" | "done";

const STEPS: { key: Stage[]; label: UiKey; hint: UiKey }[] = [
  { key: ["queued", "starting"], label: "job.warming", hint: "job.warmingHint" },
  { key: ["writing"], label: "job.writing", hint: "job.writingHint" },
  { key: ["rendering"], label: "job.rendering", hint: "job.renderingHint" },
  { key: ["finishing", "done"], label: "job.finishing", hint: "job.finishingHint" },
];

/**
 * Drives the job: polling /api/songs/{id} is what advances an unfinished job server-side (pull-based worker),
 * so this component must be mounted while a song is queued/processing. Refreshes the page when it finishes.
 */
export function JobProgress({ songId, initialStage = "queued" }: { songId: string; initialStage?: Stage }) {
  const router = useRouter();
  const { t } = useUiLang();
  const [stage, setStage] = useState<Stage>(initialStage);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    let timer: ReturnType<typeof setTimeout>;
    let delay = 3000;
    const poll = async () => {
      if (done.current) return;
      try {
        const res = await fetch(`/api/songs/${encodeURIComponent(songId)}`, { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as { status: string; stage?: Stage; error?: string | null };
          if (j.stage) setStage(j.stage);
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
  }, [songId, router, t]);

  const current = Math.max(0, STEPS.findIndex((s) => s.key.includes(stage)));
  return (
    <section data-testid="job-progress" aria-live="polite" className="rounded-lg border border-muted/20 bg-muted/5 p-5">
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.key[0]} className="flex items-start gap-3">
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
      <p className="mt-4 text-xs text-foreground/50">
        {error ?? t("job.elapsed", { time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` })}
      </p>
    </section>
  );
}

const FRIENDLY: Record<string, UiKey> = {
  allowance_reached: "job.err.allowance",
  render_failed: "job.err.render",
  content_policy: "job.err.policy",
};

type Translate = (key: UiKey, vars?: UiVars) => string;
const englishT: Translate = (key, vars) => translate("en", key, vars);

export function friendlyJobError(code?: string | null, t: Translate = englishT): string {
  return t((code && FRIENDLY[code]) || "job.err.generic");
}
