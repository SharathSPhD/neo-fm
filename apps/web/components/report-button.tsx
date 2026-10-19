"use client";

import { useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import type { UiKey } from "@/lib/i18n/ui-strings";

const REASONS: { value: string; label: UiKey }[] = [
  { value: "impersonation", label: "pub.report.impersonation" },
  { value: "hateful_or_harassing", label: "pub.report.hateful" },
  { value: "sexual_or_minor", label: "pub.report.sexual" },
  { value: "copyright", label: "pub.report.copyright" },
  { value: "other", label: "pub.report.other" },
];

/** Pass `publicId` for a published song page, or `trackId` for a station pool track. */
export function ReportButton({ publicId, trackId, compact }: { publicId?: string; trackId?: string; compact?: boolean }) {
  const { t } = useUiLang();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]!.value);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(trackId ? { track_id: trackId } : { public_id: publicId }), reason, details }) });
      setState(res.ok ? "done" : "error");
    } catch { setState("error"); }
  }

  if (state === "done") return <p role="status" className="text-xs text-foreground/60">{t("pub.report.thanks")}</p>;
  return (
    <div className="text-xs text-foreground/60">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="underline hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded">{compact ? t("station.report") : t("pub.report.open")}</button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="mt-2 flex max-w-md flex-col gap-2 rounded-md border border-muted/30 p-3">
          <label className="flex flex-col gap-1">
            <span>{t("pub.report.why")}</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded border border-muted/40 bg-transparent px-2 py-1 text-sm">
              {REASONS.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("pub.report.details")}</span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} className="rounded border border-muted/40 bg-transparent px-2 py-1 text-sm" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={state === "sending"} className="rounded border border-accent/40 bg-accent/10 px-3 py-1 text-sm text-accent disabled:opacity-50">{state === "sending" ? t("pub.report.sending") : t("pub.report.send")}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-sm underline">{t("pub.report.cancel")}</button>
          </div>
          {state === "error" ? <p role="alert" className="text-red-400">{t("pub.report.error")}</p> : null}
        </form>
      )}
    </div>
  );
}
