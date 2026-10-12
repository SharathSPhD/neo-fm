"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

export function AccountActions({ email }: { email: string }) {
  const { t } = useUiLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  function sendPasswordReset() {
    if (!email) return;
    setMessage(null);
    startTransition(async () => {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/account`,
      });
      if (error) {
        setMessage({ kind: "err", text: error.message });
        return;
      }
      setMessage({
        kind: "ok",
        text: t("acct.resetSent"),
      });
    });
  }

  function exportData() {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch("/api/account/export", { cache: "no-store" });
      if (!res.ok) {
        setMessage({
          kind: "err",
          text: t("acct.exportFail"),
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neo-fm-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage({ kind: "ok", text: t("acct.exportDone") });
    });
  }

  function deleteAccount() {
    const confirmed = window.confirm(t("acct.confirmDelete"));
    if (!confirmed) return;
    setMessage(null);
    startTransition(async () => {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setMessage({
          kind: "err",
          text: text || t("acct.deleteFail"),
        });
        return;
      }
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
      router.replace("/?account_deleted=1");
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs uppercase tracking-widest text-foreground/50">
        {t("acct.actions")}
      </h2>
      <div className="flex flex-col gap-3 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
        <ActionRow
          title={t("acct.pw.title")}
          subtitle={t("acct.pw.sub")}
          buttonLabel={t("acct.pw.btn")}
          onClick={sendPasswordReset}
          disabled={pending}
        />
        <ActionRow
          title={t("acct.export.title")}
          subtitle={t("acct.export.sub")}
          buttonLabel={t("acct.export.btn")}
          onClick={exportData}
          disabled={pending}
        />
      </div>

      <h2 className="text-xs uppercase tracking-widest text-foreground/50">
        {t("acct.danger")}
      </h2>
      <div className="flex flex-col gap-3 rounded-md border border-red-400/30 bg-red-400/5 px-5 py-4">
        <ActionRow
          title={t("acct.del.title")}
          subtitle={t("acct.del.sub")}
          buttonLabel={t("acct.del.title")}
          onClick={deleteAccount}
          disabled={pending}
          variant="danger"
        />
      </div>

      {message ? (
        <p
          role={message.kind === "err" ? "alert" : "status"}
          className={
            message.kind === "err"
              ? "text-sm text-red-300"
              : "text-sm text-emerald-300"
          }
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

function ActionRow({
  title,
  subtitle,
  buttonLabel,
  onClick,
  disabled,
  variant = "default",
}: {
  title: string;
  subtitle: string;
  buttonLabel: string;
  onClick: () => void;
  disabled: boolean;
  variant?: "default" | "danger";
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-foreground/60">{subtitle}</span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={
          variant === "danger"
            ? "rounded-md border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-medium text-red-200 transition hover:bg-red-400/20 disabled:opacity-50"
            : "rounded-md border border-muted/40 px-4 py-2 text-sm transition hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50"
        }
      >
        {buttonLabel}
      </button>
    </div>
  );
}
