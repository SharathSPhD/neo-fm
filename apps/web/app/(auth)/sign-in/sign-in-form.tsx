"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";

import { GoogleButton } from "../google-button";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

export function SignInForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const { t } = useUiLang();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, startTransition] = useTransition();
  // Until hydration the native form would submit credentials as a GET query string; keep submit disabled until JS owns the form.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    const supabase = createBrowserSupabase();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr) {
      setError(signInErr.message);
      return;
    }
    startTransition(() => {
      router.replace(next ?? "/library");
      // No router.refresh() here: in Next 15 it cancels the replace above; navigating to a dynamic page refetches anyway.
    });
  }

  return (
    <div className="flex flex-col gap-4">
    <GoogleButton next={next} />
    <form method="post" className="flex flex-col gap-4" onSubmit={onSubmit}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          {t("auth.email")}
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          {t("auth.password")}
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={6}
          className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-none focus:border-accent"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || !ready}
        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background shadow-[0_0_28px_-8px_hsl(var(--accent))] transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
      >
        {pending ? t("auth.signIn.pending") : t("auth.signIn.title")}
      </button>
    </form>
    </div>
  );
}
