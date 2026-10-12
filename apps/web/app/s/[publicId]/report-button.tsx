"use client";

import { useState } from "react";

const REASONS: { value: string; label: string }[] = [
  { value: "impersonation", label: "Impersonates a real person or artist" },
  { value: "hateful_or_harassing", label: "Hateful or harassing" },
  { value: "sexual_or_minor", label: "Sexual content or involves minors" },
  { value: "copyright", label: "Copies someone's copyrighted work" },
  { value: "other", label: "Something else" },
];

export function ReportButton({ publicId }: { publicId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]!.value);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ public_id: publicId, reason, details }) });
      setState(res.ok ? "done" : "error");
    } catch { setState("error"); }
  }

  if (state === "done") return <p role="status" className="text-xs text-foreground/60">Thanks — we&apos;ll review this report. Urgent? Write to grievance@neo-fm.com.</p>;
  return (
    <div className="text-xs text-foreground/60">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="underline hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent rounded">Report this song</button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="mt-2 flex max-w-md flex-col gap-2 rounded-md border border-muted/30 p-3">
          <label className="flex flex-col gap-1">
            <span>Why are you reporting it?</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded border border-muted/40 bg-transparent px-2 py-1 text-sm">
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>Details (optional)</span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} className="rounded border border-muted/40 bg-transparent px-2 py-1 text-sm" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={state === "sending"} className="rounded border border-accent/40 bg-accent/10 px-3 py-1 text-sm text-accent disabled:opacity-50">{state === "sending" ? "Sending…" : "Send report"}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-sm underline">Cancel</button>
          </div>
          {state === "error" ? <p role="alert" className="text-red-400">Couldn&apos;t send — please try again.</p> : null}
        </form>
      )}
    </div>
  );
}
