"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

const HANDLE_RE = /^[a-z0-9_]+$/;

export function HandleForm({ initial }: { initial: string }) {
  const router = useRouter();
  const { t } = useUiLang();
  const [handle, setHandle] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function validate(value: string): string | null {
    const v = value.trim();
    if (v.length < 3) return t("handle.tooShort");
    if (v.length > 30) return t("handle.tooLong");
    if (!HANDLE_RE.test(v)) return t("handle.invalidChars");
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = handle.trim().toLowerCase();
    const localError = validate(v);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/account/handle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: v }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "handle_taken") {
          setError(t("handle.taken"));
        } else if (data.error === "handle_reserved") {
          setError(t("handle.reserved"));
        } else {
          setError(data.details ?? t("handle.failed"));
        }
        return;
      }
      router.replace(`/u/${v}`);
      // No router.refresh() here: in Next 15 it cancels the replace above; navigating to a dynamic page refetches anyway.
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          {t("handle.label")}
        </span>
        <div className="flex items-center rounded-md border border-muted/30 bg-transparent focus-within:border-accent">
          <span className="pl-3 text-foreground/40">@</span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            maxLength={30}
            placeholder="ravi.kumar"
            autoFocus
            className="flex-1 bg-transparent px-2 py-2 text-base outline-hidden"
            required
          />
        </div>
        <span className="text-[11px] text-foreground/50">
          {t("handle.hint")}
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? t("handle.saving") : t("handle.claim")}
      </button>
    </form>
  );
}
