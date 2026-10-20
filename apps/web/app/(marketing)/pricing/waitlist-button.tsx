"use client";

import { useState, useTransition } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

interface Props {
  tier: "creator" | "pro";
  label: string;
}

export function WaitlistButton({ tier, label }: Props) {
  const { t } = useUiLang();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    kind: "ok" | "dup" | "err";
    text: string;
  } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const value = email.trim();
    if (!value || !value.includes("@")) {
      setMessage({ kind: "err", text: t("pub.waitlist.badEmail") });
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, tier, source: "pricing" }),
      });
      if (!res.ok) {
        setMessage({
          kind: "err",
          text: t("pub.waitlist.failed"),
        });
        return;
      }
      const body = (await res.json()) as {
        joined: boolean;
        already_on_list: boolean;
      };
      if (body.joined) {
        setMessage({
          kind: "ok",
          text: t("pub.waitlist.ok"),
        });
        setEmail("");
      } else if (body.already_on_list) {
        setMessage({
          kind: "dup",
          text: t("pub.waitlist.dup"),
        });
      } else {
        setMessage({ kind: "err", text: t("pub.waitlist.unexpected") });
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded-md border border-muted/40 px-4 py-2 text-center text-sm font-medium text-foreground transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
      >
        {label}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={`waitlist-${tier}`} className="sr-only">
        {t("account.email")}
      </label>
      <input
        id={`waitlist-${tier}`}
        type="email"
        autoComplete="email"
        autoFocus
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-sm outline-hidden focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? t("pub.waitlist.joining") : t("pub.waitlist.notify")}
      </button>
      {message ? (
        <p
          role={message.kind === "err" ? "alert" : "status"}
          className={
            message.kind === "err"
              ? "text-xs text-red-300"
              : message.kind === "dup"
                ? "text-xs text-foreground/60"
                : "text-xs text-emerald-300"
          }
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
