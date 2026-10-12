"use client";

import { useEffect, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

type State = { consent: boolean; card: string } | null;

/** Opt-in personalization: what we use, in plain words, with a switch and a forget button. */
export function TastePanel() {
  const { t } = useUiLang();
  const [s, setS] = useState<State>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/me/taste", { cache: "no-store" });
    if (r.ok) setS((await r.json()) as State);
  }
  useEffect(() => { void load(); }, []);

  async function setConsent(consent: boolean) {
    setBusy(true);
    await fetch("/api/me/taste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent }) });
    await load();
    setBusy(false);
  }
  async function forget() {
    if (!window.confirm(t("acct.taste.confirm"))) return;
    setBusy(true);
    await fetch("/api/me/taste", { method: "DELETE" });
    await load();
    setBusy(false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-muted/20 p-5" aria-labelledby="taste-h">
      <h2 id="taste-h" className="text-lg font-medium">{t("acct.taste.title")}</h2>
      <p className="text-sm text-foreground/70">
        {t("acct.taste.body")}
      </p>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={s?.consent ?? false} disabled={busy || s === null} onChange={(e) => void setConsent(e.target.checked)} />
        {t("acct.taste.consent")}
      </label>
      {s?.consent ? (
        <p className="text-xs text-foreground/60">
          {s.card ? t("acct.taste.current", { card: s.card.replace(/^Listener taste \(opt-in, derived from their own likes\/plays\): /, "").replace(/\. Use only.*$/, "") }) : t("acct.taste.none")}
        </p>
      ) : null}
      <div>
        <button type="button" onClick={() => void forget()} disabled={busy} className="rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-50">
          {t("acct.taste.forget")}
        </button>
      </div>
    </section>
  );
}
