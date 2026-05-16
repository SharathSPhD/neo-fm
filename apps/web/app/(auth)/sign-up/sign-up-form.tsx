"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";

export function SignUpForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      setInfo(
        "We sent a confirmation link to your inbox. Click it from the same browser to come right back into the app.",
      );
      return;
    }
    startTransition(() => {
      router.replace(nextPath);
      router.refresh();
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
    setInfo("Confirmation email re-sent — check your inbox (and spam).");
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          Password
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-base outline-none focus:border-accent"
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
        disabled={pending}
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create account"}
      </button>
      {pendingEmail ? (
        <button
          type="button"
          onClick={resend}
          className="self-start text-xs text-foreground/60 hover:text-foreground underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        >
          Didn&apos;t get the email? Resend to {pendingEmail}
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
