"use client";

/**
 * First-time library visit modal (Sprint F).
 *
 * Fires on the first /library mount per browser (localStorage flag).
 * Explains favorites + filters + share + recover. Dismissable; we
 * never re-show after dismissal even on a different device because
 * the flag is set on first-mount client-side. (Future: persist on
 * users.preferences when migration 0023 lands.)
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "neo-fm:library-onboarded";

export function LibraryOnboardingModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {
      // localStorage blocked (private mode); just skip.
    }
  }, []);

  function close() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // best effort
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-muted/30 bg-background p-6 shadow-2xl">
        <h2
          id="library-onboarding-title"
          className="text-xl font-medium tracking-tight"
        >
          Welcome to your library
        </h2>
        <p className="mt-2 text-sm text-foreground/70">
          A few things you can do here:
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-sm text-foreground/80">
          <li>
            <span className="text-amber-300">★</span>{" "}
            <strong>Favorite</strong> a song to pin it.
          </li>
          <li>
            <span className="text-accent">🔎</span>{" "}
            <strong>Filter</strong> by style or language, search by title.
          </li>
          <li>
            <span className="text-accent">⋯</span>{" "}
            <strong>Rename</strong> or <strong>delete</strong> a song from the
            row menu.
          </li>
          <li>
            <span className="text-accent">↻</span>{" "}
            <strong>Recover</strong> appears when a song gets stuck.
          </li>
        </ul>
        <button
          type="button"
          onClick={close}
          className="mt-6 w-full rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
