"use client";

/**
 * Operator view over /api/admin/harness-policy (action "report"): per-arm posterior and traffic share. Ships no data; the operator
 * pastes the ops secret, kept in sessionStorage only (same pattern as /admin/health).
 */
import { useCallback, useEffect, useState } from "react";

import type { ArmReport } from "../../../lib/harness-policy/report";
import type { PolicyRow } from "../../../lib/harness-policy/policy";

const KEY = "neo-fm-ops-secret";
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export default function HarnessPage() {
  const [secret, setSecret] = useState("");
  const [days, setDays] = useState(7);
  const [data, setData] = useState<{ enabled: boolean; rows: ArmReport[]; policy: PolicyRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (s: string, d: number) => {
    setErr(null);
    try {
      const r = await fetch("/api/admin/harness-policy", { method: "POST", headers: { authorization: `Bearer ${s}`, "content-type": "application/json" }, body: JSON.stringify({ action: "report", days: d }), cache: "no-store" });
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
      if (saved) { setSecret(saved); void load(saved, 7); }
    } catch { /* storage unavailable: paste the secret again */ }
  }, [load]);

  const promoted = (r: ArmReport) => data?.policy.find((p) => p.language === r.language && (p.tier === r.tier || p.tier === "*") && p.arm_id === r.arm_id);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Harness policy</h1>
      <form onSubmit={(e) => { e.preventDefault(); try { sessionStorage.setItem(KEY, secret); } catch { /* see above */ } void load(secret, days); }} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">Ops secret
          <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className="rounded-sm border px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">Window
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-sm border px-2 py-1">{[1, 7, 30, 90].map((d) => <option key={d} value={d}>{d}d</option>)}</select>
        </label>
        <button type="submit" className="rounded-sm border px-3 py-1 text-sm">Load</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {data && (
        <>
          <p className="text-sm">HARNESS_POLICY is <strong>{data.enabled ? "on" : "off"}</strong> in this deployment{data.policy.length === 0 ? "; no arms promoted yet, so the env flags decide." : "."}</p>
          {data.rows.length === 0 ? <p className="text-sm opacity-70">No posteriors or recorded choices yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b">{["Language", "Tier", "Arm", "Role", "Win rate vs champion (90%)", "Judged / heard (n)", "Songs", "Traffic share", "Avg listener reward"].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.language}|${r.tier}|${r.arm_id}`} className="border-b">
                    <td className="py-1 pr-3">{r.language}</td><td className="pr-3">{r.tier}</td><td className="pr-3">{r.arm_id}</td>
                    <td className="pr-3">{promoted(r)?.role ?? "not promoted"}</td>
                    <td className="pr-3">{pct(r.mean)} ({pct(r.low)}-{pct(r.high)})</td>
                    <td className="pr-3">{r.n.toFixed(1)}</td><td className="pr-3">{r.songs} ({r.viaPolicy} via policy)</td>
                    <td className="pr-3">{pct(r.share)}</td><td className="pr-3">{r.avgReward === null ? "-" : r.avgReward.toFixed(2)} ({r.settled} settled)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
