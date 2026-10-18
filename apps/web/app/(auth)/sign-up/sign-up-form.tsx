"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

export function SignUpForm() {
  const router = useRouter();
  const { t } = useUiLang();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Until hydration the native form would submit credentials as a GET query string; keep submit disabled until JS owns the form.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  // `next` is round-tripped through the confirmation link so a visitor
  // who tried to deep-link (e.g. /sign-up?next=/songs/new) lands where
  // they wanted after confirming their email. Default: /library.
  const nextPath = sanitizeNext(search?.get("next"));

  function callbackUrl(): string {
    // Use window.origin instead of NEXT_PUBLIC_SITE_URL so preview
    // deployments work without re-publishing env vars.
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    const supabase = createBrowserSupabase();
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: callbackUrl(),
      },
    });
    if (signUpErr) {
      setError(signUpErr.message);
      return;
    }
    if (!data.session) {
      // Email confirmation required. Stash the email so the visitor
      // can resend the link without having to retype it.
      setPendingEmail(email);
      setInfo(t("auth.signUp.confirmSent"));
      return;
    }
    startTransition(() => {
      router.replace(nextPath);
      // No router.refresh() here: in Next 15 it cancels the replace above; navigating to a dynamic page refetches anyway.
    });
  }

  async function resend() {
    if (!pendingEmail) return;
    setError(null);
    setInfo(null);
    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (err) {
      setError(err.message);
      return;
    }
    setInfo(t("auth.signUp.resent"));
  }

  return (
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
          autoComplete="new-password"
          minLength={8}
          className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-none focus:border-accent"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {info ? (
        <p role="status" className="text-sm text-accent">
          {info}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || !ready}
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? t("auth.signUp.pending") : t("auth.signUp.title")}
      </button>
      {pendingEmail ? (
        <button
          type="button"
          onClick={resend}
          className="self-start text-xs text-foreground/60 hover:text-foreground underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        >
          {t("auth.signUp.resend", { email: pendingEmail })}
        </button>
      ) : null}
    </form>
  );
}

/* Defensive: only allow same-origin paths. Anything that looks like a
 * full URL is replaced with the safe default. */
function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return "/library";
  if (!raw.startsWith("/")) return "/library";
  if (raw.startsWith("//")) return "/library";
  return raw;
}
