"use client";

/**
 * Operator dashboard over /api/admin/health-summary. The page ships no data: the operator pastes
 * CRON_SECRET / AGENT_TICK_SECRET, kept in sessionStorage only, and the browser calls the bearer-protected endpoint.
 */
import { useCallback, useEffect, useState } from "react";

import type { FunnelSummary } from "../../../lib/ops/funnel";
import type { ErrorGroup } from "../../../lib/obs/group-errors";
import type { HealthSummary } from "../../../lib/ops/health-summary";
import type { TrendPoint } from "../../../lib/ops/snapshot";

const KEY = "neo-fm-ops-secret";
const mins = (s: number | null) => (s === null ? "-" : `${(s / 60).toFixed(1)} min`);

export default function HealthPage() {
  const [secret, setSecret] = useState("");
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<(HealthSummary & { truncated?: boolean }) | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [trendDays, setTrendDays] = useState(7);
  const [funnel, setFunnel] = useState<FunnelSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ groups: ErrorGroup[]; total: number; truncated: boolean } | null>(null);

  const load = useCallback(async (s: string, h: number, td: number) => {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/health-summary?hours=${h}`, { headers: { authorization: `Bearer ${s}` }, cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 401 ? "Secret rejected" : `Request failed (${r.status})`);
      setData(await r.json());
      // Funnel is secondary: a missing migration should not hide the health numbers.
      const f = await fetch(`/api/admin/funnel?days=${Math.max(1, Math.round(h / 24))}`, { headers: { authorization: `Bearer ${s}` }, cache: "no-store" });
      setFunnel(f.ok ? await f.json() : null);
      const t = await fetch(`/api/admin/health-trends?days=${td}`, { headers: { authorization: `Bearer ${s}` }, cache: "no-store" });
      setTrend(t.ok ? (await t.json()).points : null);
    } catch (e) {
      setData(null);
      setErr((e as Error).message);
    }
    // Independent of the job summary: a failure here must not hide the rest of the dashboard.
    try {
      const r = await fetch(`/api/admin/client-errors?hours=${h}`, { headers: { authorization: `Bearer ${s}` }, cache: "no-store" });
      setErrors(r.ok ? await r.json() : null);
    } catch {
      setErrors(null);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) { setSecret(saved); void load(saved, 24, 7); }
    } catch { /* storage unavailable: the operator just pastes the secret again */ }
  }, [load]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try { sessionStorage.setItem(KEY, secret); } catch { /* see above */ }
    void load(secret, hours, trendDays);
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
          <div
            role={data.alerts.length ? "alert" : "status"}
            className={`sticky top-0 z-10 rounded border p-3 text-sm ${data.alerts.length ? "border-red-500 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" : "border-green-600"}`}
          >
            {data.alerts.length ? <ul className="list-disc pl-5">{data.alerts.map((a) => <li key={a}>{a}</li>)}</ul> : "No alerts"}
            {data.truncated ? <p>Job list truncated; counts are a floor.</p> : null}
          </div>
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
          {funnel && (
            <Table title={`Funnel (${funnel.window_days}d)`} head={["Step", "Count", "Conversion"]} rows={[
              ["Landing views", String(funnel.views.landing_view), ""],
              ["Sign-up page views", String(funnel.views.signup_view), pct(funnel.conversion.landing_to_signup_view)],
              ["Sign-ups", String(funnel.signups), pct(funnel.conversion.signup_view_to_signup)],
              ["Made a first song", String(funnel.first_song_users), pct(funnel.conversion.signup_to_first_song)],
              ["Songs shared", String(funnel.songs_shared), ""],
              ["Songs gifted (dedicated)", String(funnel.songs_gifted), ""],
              ["Shared-song views", String(funnel.views.share_view), ""],
              ["Pricing views", String(funnel.views.pricing_view), ""],
              ["Upgrade clicks (checkout started)", String(funnel.views.checkout_started), pct(funnel.conversion.pricing_view_to_checkout)],
              ["Paying sign-ups", String(funnel.paid_users), pct(funnel.conversion.signup_to_paid)],
            ]} />
          )}
          {funnel && <LaunchFunnel funnel={funnel} />}
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="font-medium">Trends</h2>
              {[7, 30].map((d) => (
                <button key={d} type="button" aria-pressed={trendDays === d} className={`rounded border px-2 text-xs ${trendDays === d ? "font-semibold" : "opacity-70"}`}
                  onClick={() => { setTrendDays(d); void load(secret, hours, d); }}>{d}d</button>
              ))}
            </div>
            {!trend || trend.length === 0 ? (
              <p className="text-sm opacity-70">No daily snapshots yet. They are stored once a day at 08:40 UTC.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Spark title="Failure rate" unit="%" values={trend.map((p) => (p.failure_rate === null ? null : p.failure_rate * 100))} />
                <Spark title="p90 latency" unit=" min" values={trend.map((p) => (p.p90_s === null ? null : p.p90_s / 60))} />
                <Spark title="Lyria reserved" unit="£" values={trend.map((p) => p.lyria_reserved_gbp)} />
                <Spark title="Sign-ups" unit="" values={trend.map((p) => p.signups)} />
              </div>
            )}
          </section>
          <section>
            <h2 className="mb-2 font-medium">Recent errors</h2>
            {!errors ? <p className="text-sm opacity-70">Error reports unavailable.</p> : errors.groups.length === 0 ? (
              <p className="text-sm opacity-70">No browser errors reported in this window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr>{["Count", "Error", "Page", "Last seen", "Request"].map((h) => <th key={h} className="text-left font-normal opacity-70">{h}</th>)}</tr></thead>
                <tbody>
                  {errors.groups.map((g) => (
                    <tr key={g.fingerprint} className="align-top">
                      <td>{g.count}</td>
                      <td className="break-words"><span className="font-medium">{g.name}</span>: {g.message}</td>
                      <td className="break-all">{g.route || "-"}</td>
                      <td>{g.last_seen.slice(5, 16).replace("T", " ")}</td>
                      <td className="break-all font-mono text-xs">{g.sample_request_id?.slice(0, 8) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {errors?.truncated ? <p className="mt-1 text-xs opacity-60">Showing the newest {errors.total} reports; counts are a floor.</p> : null}
          </section>
          <p className="text-xs opacity-60">Generated {data.generated_at}</p>
        </>
      )}
    </main>
  );
}

const pct = (r: number | null) => (r === null ? "-" : `${Math.round(r * 100)}%`);

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

function Spark({ title, unit, values }: { title: string; unit: string; values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  const last = pts.length ? pts[pts.length - 1]!.v : null;
  const max = Math.max(1e-9, ...pts.map((p) => p.v));
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * 100 : 50);
  const path = pts.map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(1)},${(28 - (p.v / max) * 26).toFixed(1)}`).join(" ");
  return (
    <div className="rounded border p-3">
      <div className="text-xs uppercase opacity-70">{title}</div>
      <div className="text-lg">{last === null ? "-" : unit === "£" ? `£${last.toFixed(2)}` : `${Math.round(last * 10) / 10}${unit}`}</div>
      <svg viewBox="0 0 100 30" className="h-8 w-full" role="img" aria-label={`${title} over ${values.length} days`}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

const LAUNCH_COLUMNS: { label: string; event?: keyof FunnelSummary["views"] }[] = [
  { label: "Home views", event: "landing_view" },
  { label: "Plays (anon)", event: "station_play_anon" },
  { label: "Plays (signed in)", event: "station_play_user" },
  { label: "3+ tracks", event: "listened_3" },
  { label: "Nudge shown", event: "nudge_shown" },
  { label: "Nudge clicked", event: "nudge_clicked" },
  { label: "Sign-ups" },
  { label: "Onboarded", event: "onboarding_done" },
  { label: "Shares", event: "station_share" },
  { label: "WhatsApp", event: "whatsapp_click" },
];

/** Launch funnel: one row per UTC day, newest first. Counters are anonymous per-day counts; sign-ups come from the users table. */
function LaunchFunnel({ funnel }: { funnel: FunnelSummary }) {
  const days = [...new Set([...Object.keys(funnel.by_day), ...Object.keys(funnel.signups_by_day)])].sort().reverse();
  const cell = (day: string, c: (typeof LAUNCH_COLUMNS)[number]) =>
    String(c.event ? (funnel.by_day[day]?.[c.event] ?? 0) : (funnel.signups_by_day[day] ?? 0));
  return (
    <Table
      title={`Launch funnel by day (${funnel.window_days}d)`}
      head={["Day (UTC)", ...LAUNCH_COLUMNS.map((c) => c.label)]}
      rows={[
        ["Total", ...LAUNCH_COLUMNS.map((c) => String(c.event ? funnel.views[c.event] : funnel.signups))],
        ...days.map((d) => [d, ...LAUNCH_COLUMNS.map((c) => cell(d, c))]),
      ]}
    />
  );
}
