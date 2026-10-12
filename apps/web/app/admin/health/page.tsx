"use client";

/**
 * Operator dashboard over /api/admin/health-summary. The page ships no data: the operator pastes
 * CRON_SECRET / AGENT_TICK_SECRET, kept in sessionStorage only, and the browser calls the bearer-protected endpoint.
 */
import { useCallback, useEffect, useState } from "react";

import type { HealthSummary } from "../../../lib/ops/health-summary";

const KEY = "neo-fm-ops-secret";
const mins = (s: number | null) => (s === null ? "-" : `${(s / 60).toFixed(1)} min`);

export default function HealthPage() {
  const [secret, setSecret] = useState("");
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<(HealthSummary & { truncated?: boolean }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (s: string, h: number) => {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/health-summary?hours=${h}`, { headers: { authorization: `Bearer ${s}` }, cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 401 ? "Secret rejected" : `Request failed (${r.status})`);
      setData(await r.json());
    } catch (e) {
      setData(null);
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) { setSecret(saved); void load(saved, 24); }
    } catch { /* storage unavailable: the operator just pastes the secret again */ }
  }, [load]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try { sessionStorage.setItem(KEY, secret); } catch { /* see above */ }
    void load(secret, hours);
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Ops health</h1>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          Ops secret
          <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          Window
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="rounded border px-2 py-1">
            {[1, 6, 24, 72, 168].map((h) => <option key={h} value={h}>{h}h</option>)}
          </select>
        </label>
        <button type="submit" className="rounded border px-3 py-1 text-sm">Load</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {data && (
        <>
          <p role="status" className={`rounded border p-3 text-sm ${data.alerts.length ? "border-red-500" : "border-green-600"}`}>
            {data.alerts.length ? data.alerts.join(" · ") : "No alerts"}
            {data.truncated ? " (job list truncated; counts are a floor)" : ""}
          </p>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["queued", "processing", "completed", "failed"].map((k) => (
              <div key={k} className="rounded border p-3"><div className="text-xs uppercase opacity-70">{k}</div><div className="text-2xl">{data.counts[k] ?? 0}</div></div>
            ))}
          </section>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Oldest queued" value={mins(data.oldest_queued_age_s)} />
            <Stat label="Median latency" value={mins(data.latency_s.p50)} />
            <Stat label="p90 latency" value={mins(data.latency_s.p90)} />
            <Stat label="Songs timed" value={String(data.latency_s.n)} />
          </section>
          <section>
            <h2 className="mb-2 font-medium">Spend vs cap</h2>
            {data.spend.global.length === 0 && <p className="text-sm opacity-70">No reservations yet.</p>}
            {data.spend.global.map((g) => (
              <div key={g.provider} className="mb-2 text-sm">
                {g.provider}: £{g.reserved_gbp.toFixed(2)}{g.cap_gbp ? ` of £${g.cap_gbp}` : ""}
                {g.cap_gbp ? <progress className="ml-2 align-middle" max={g.cap_gbp} value={Math.min(g.reserved_gbp, g.cap_gbp)} /> : null}
              </div>
            ))}
          </section>
          <Table title="Failure reasons" head={["Reason", "Jobs"]} rows={Object.entries(data.failures_by_code).map(([k, v]) => [k, String(v)])} />
          <Table title="Diction match" head={["Language", "Avg match %", "Audited", "QA errors"]}
            rows={Object.entries(data.diction_by_language).map(([l, d]) => [l, d.avg_match_pct === null ? "-" : String(d.avg_match_pct), String(d.n), String(d.errors)])} />
          <p className="text-xs opacity-60">Generated {data.generated_at}</p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded border p-3"><div className="text-xs uppercase opacity-70">{label}</div><div className="text-lg">{value}</div></div>;
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <section>
      <h2 className="mb-2 font-medium">{title}</h2>
      {rows.length === 0 ? <p className="text-sm opacity-70">None in this window.</p> : (
        <table className="w-full text-sm">
          <thead><tr>{head.map((h) => <th key={h} className="text-left font-normal opacity-70">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
