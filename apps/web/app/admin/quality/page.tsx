"use client";

/**
 * Prod quality monitor over /api/admin/quality-monitor. Like the health page, it ships no data: the operator pastes
 * CRON_SECRET / AGENT_TICK_SECRET (kept in sessionStorage only) and the browser calls the bearer-protected endpoint.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { QualityGroup, QualitySummary } from "../../../lib/ops/quality-monitor";

const KEY = "neo-fm-ops-secret";
const f = (x: number | null, d = 1) => (x === null ? "-" : x.toFixed(d));
const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);

interface Roll { n: number; diction_n: number; match: number; under80: number; script: number; uniq: number }

export default function QualityPage() {
  const [secret, setSecret] = useState("");
  const [days, setDays] = useState(14);
  const [data, setData] = useState<(QualitySummary & { truncated?: boolean }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (s: string, d: number) => {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/quality-monitor?days=${d}`, { headers: { authorization: `Bearer ${s}` }, cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 401 ? "Secret rejected" : `Request failed (${r.status})`);
      setData(await r.json());
    } catch (e) {
      setData(null);
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem(KEY);
      if (s) { setSecret(s); void load(s, days); }
    } catch { /* sessionStorage unavailable */ }
  }, [load, days]);

  // Roll the day rows up per language / tier / arm so each live arm reads as one line; the day table below shows the trend.
  const rolled = useMemo(() => {
    const m = new Map<string, Roll & { language: string; tier: string; arm: string }>();
    for (const g of data?.groups ?? []) {
      const k = `${g.language}|${g.tier}|${g.arm}`;
      const r = m.get(k) ?? { language: g.language, tier: g.tier, arm: g.arm, n: 0, diction_n: 0, match: 0, under80: 0, script: 0, uniq: 0 };
      r.n += g.n; r.diction_n += g.diction_n;
      r.match += (g.avg_unordered_pct ?? 0) * g.diction_n; r.under80 += (g.under80_share ?? 0) * g.diction_n;
      r.script += (g.avg_script_share ?? 0) * g.lyrics_n; r.uniq += (g.avg_uniq_ratio ?? 0) * g.lyrics_n;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => a.language.localeCompare(b.language) || a.tier.localeCompare(b.tier) || a.arm.localeCompare(b.arm));
  }, [data]);

  const cell = (g: QualityGroup) => `${g.avg_unordered_pct === null ? "-" : Math.round(g.avg_unordered_pct)} (${g.diction_n})`;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Prod quality</h1>
      <p>Songs by language, tier and harness arm. Diction is the stored Gemini sung-word score (order-free); lyric metrics are free structure signals.</p>
      <form onSubmit={(e) => { e.preventDefault(); try { sessionStorage.setItem(KEY, secret); } catch { /* ignore */ } void load(secret, days); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="CRON_SECRET" aria-label="Ops secret" style={{ flex: "1 1 240px", padding: 8 }} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window in days" style={{ padding: 8 }}>
          {[7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <button type="submit" style={{ padding: "8px 16px" }}>Load</button>
      </form>
      {err && <p role="alert" style={{ color: "#b00020" }}>{err}</p>}
      {data && (
        <>
          <p>{data.rows} finished songs, {pct(data.meta_coverage)} carry arm data{data.truncated ? " (window truncated at the row cap)" : ""}.</p>
          <h2>By arm</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>{["Lang", "Tier", "Arm", "Songs", "Diction n", "Avg diction", "Under 80", "Script share", "Unique lines"].map((h) => <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #888" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rolled.map((r) => (
                  <tr key={`${r.language}${r.tier}${r.arm}`}>
                    <td style={{ padding: 6 }}>{r.language}</td><td style={{ padding: 6 }}>{r.tier}</td><td style={{ padding: 6 }}>{r.arm}</td>
                    <td style={{ padding: 6 }}>{r.n}</td><td style={{ padding: 6 }}>{r.diction_n}</td>
                    <td style={{ padding: 6 }}>{r.diction_n ? f(r.match / r.diction_n, 0) : "-"}</td>
                    <td style={{ padding: 6 }}>{r.diction_n ? pct(r.under80 / r.diction_n) : "-"}</td>
                    <td style={{ padding: 6 }}>{r.n ? pct(r.script / r.n) : "-"}</td><td style={{ padding: 6 }}>{r.n ? pct(r.uniq / r.n) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Daily trend (avg diction, scored songs)</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>{["Day", "Lang", "Tier", "Arm", "Songs", "Diction (n)"].map((h) => <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #888" }}>{h}</th>)}</tr></thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={`${g.day}${g.language}${g.tier}${g.arm}`}>
                    <td style={{ padding: 6 }}>{g.day}</td><td style={{ padding: 6 }}>{g.language}</td><td style={{ padding: 6 }}>{g.tier}</td><td style={{ padding: 6 }}>{g.arm}</td>
                    <td style={{ padding: 6 }}>{g.n}</td><td style={{ padding: 6 }}>{cell(g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Refs usage</h2>
          {Object.keys(data.refs_usage).length === 0 ? <p>No logged refs yet.</p> : Object.entries(data.refs_usage).map(([lang, m]) => (
            <p key={lang}><strong>{lang}</strong>: {Object.entries(m).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} x${n}`).join(", ")}</p>
          ))}
        </>
      )}
    </main>
  );
}
