"use client";

import { useState, useTransition } from "react";

interface Props {
  tier: "creator" | "pro";
  label: string;
}

export function WaitlistButton({ tier, label }: Props) {
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
      setMessage({ kind: "err", text: "That doesn't look like an email." });
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
          text: "Couldn't join. Try again in a minute?",
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
          text: "On the list. We'll write the day we open.",
        });
        setEmail("");
      } else if (body.already_on_list) {
        setMessage({
          kind: "dup",
          text: "Already on the list. We'll be in touch.",
        });
      } else {
        setMessage({ kind: "err", text: "Unexpected response. Try again." });
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
        Email
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
        className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? "Joining…" : "Notify me"}
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
