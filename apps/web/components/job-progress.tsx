"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Stage = "queued" | "starting" | "writing" | "rendering" | "finishing" | "done";

const STEPS: { key: Stage[]; label: string; hint: string }[] = [
  { key: ["queued", "starting"], label: "Warming up", hint: "Your brief is safe and in the queue." },
  { key: ["writing"], label: "Writing lyrics", hint: "Our poets draft several versions; the Pratyabhijna engine scores them for freshness and form." },
  { key: ["rendering"], label: "Composing the music", hint: "Lyria is singing your lyrics with the right diction." },
  { key: ["finishing", "done"], label: "Finishing touches", hint: "Saving your track and checking pronunciation." },
];

/**
 * Drives the job: polling /api/songs/{id} is what advances an unfinished job server-side (pull-based worker),
 * so this component must be mounted while a song is queued/processing. Refreshes the page when it finishes.
 */
export function JobProgress({ songId, initialStage = "queued" }: { songId: string; initialStage?: Stage }) {
  const router = useRouter();
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
            if (j.status === "failed") setError(friendlyJobError(j.error));
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
  }, [songId, router]);

  const current = Math.max(0, STEPS.findIndex((s) => s.key.includes(stage)));
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
                <p className="text-sm font-medium">{s.label}</p>
                {state === "active" ? <p className="text-xs text-foreground/60">{s.hint}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-foreground/50">
        {error ?? `Elapsed ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} of about 4–7 minutes · you can leave this page — your song keeps going.`}
      </p>
    </section>
  );
}

const FRIENDLY: Record<string, string> = {
  allowance_reached: "You've used this month's song allowance. It resets on the 1st, or upgrade your plan for more songs.",
  render_failed: "The music engine had a hiccup and we couldn't finish this one. Your allowance was not used; please try again.",
  timed_out: "This one took too long and we stopped it. Your allowance was not used; please try again.",
  content_policy: "We couldn't make this one because it didn't pass our content guidelines. Try rewording your idea.",
};

export function friendlyJobError(code?: string | null): string {
  return (code && FRIENDLY[code]) || "Something went wrong while making this song. Please try again.";
}
