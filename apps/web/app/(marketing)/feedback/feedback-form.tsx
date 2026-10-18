"use client";

import { useState, useTransition } from "react";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

export function FeedbackForm() {
  const { t } = useUiLang();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<
    | { kind: "ok"; id: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOutcome(null);
    if (subject.trim().length === 0 || body.trim().length === 0) {
      setOutcome({ kind: "err", message: t("feedback.errRequired") });
      return;
    }
    if (body.trim().length > 5000) {
      setOutcome({
        kind: "err",
        message: t("feedback.errTooLong"),
      });
      return;
    }
    const referrer =
      typeof document !== "undefined" ? document.referrer || null : null;
    startTransition(async () => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          referrer,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setOutcome({
          kind: "err",
          message: text || t("feedback.errFailed"),
        });
        return;
      }
      const data = (await res.json()) as { id: string };
      setOutcome({ kind: "ok", id: data.id });
      setSubject("");
      setBody("");
    });
  }

  if (outcome?.kind === "ok") {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-200">
        <p>
          {t("feedback.thanks.before")} <code>{outcome.id.slice(0, 8)}</code>.
        </p>
        <button
          type="button"
          onClick={() => setOutcome(null)}
          className="self-start text-xs text-emerald-300 underline"
        >
          {t("feedback.sendAnother")}
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          {t("feedback.subject")}
        </span>
        <input
          type="text"
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("feedback.subjectPh")}
          className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-none focus:border-accent"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/50">
          {t("feedback.details")}
        </span>
        <textarea
          rows={8}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("feedback.detailsPh")}
          className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-base outline-none focus:border-accent"
          required
        />
        <span className="self-end text-[10px] text-foreground/40">
          {body.length}/5000
        </span>
      </label>
      {outcome?.kind === "err" ? (
        <p role="alert" className="text-sm text-red-300">
          {outcome.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? t("feedback.sending") : t("feedback.send")}
      </button>
    </form>
  );
}
