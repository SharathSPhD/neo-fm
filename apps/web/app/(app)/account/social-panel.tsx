"use client";

import { useEffect, useState } from "react";

type Row = { platform: string; route: "api" | "api_private" | "share_sheet"; neofm_app_ready: boolean; connected: boolean; mode: string | null; label: string | null };
type State = { enabled: boolean; ready?: boolean; own_app_allowed?: boolean; platforms?: Row[] };

const NAME: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };
const NOTE: Record<Row["route"], string> = {
  api: "Posts straight from neo-fm.",
  api_private: "Posts as private until the platform approves neo-fm; you can publish it from the app.",
  share_sheet: "Opens the app with your caption ready to paste.",
};

/** Connect your own social accounts. Renders nothing until LISTENER_SOCIAL_ENABLED is on. */
export function SocialPanel() {
  const [s, setS] = useState<State | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const [cid, setCid] = useState("");
  const [sec, setSec] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/social/me", { cache: "no-store" });
    if (r.ok) setS((await r.json()) as State);
  }
  useEffect(() => { void load(); }, []);

  async function connect(platform: string, mode: "neofm_app" | "own_app") {
    setErr(null);
    const r = await fetch(`/api/social/me/connect/${platform}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mode === "own_app" ? { mode, clientId: cid, clientSecret: sec } : { mode }),
    });
    const j = (await r.json()) as { url?: string; error?: string };
    if (!r.ok || !j.url) return setErr(j.error === "platform_not_configured" ? "Not available for this platform yet." : (j.error ?? "Could not start sign-in."));
    window.location.href = j.url;
  }
  async function disconnect(platform: string) {
    if (!window.confirm(`Disconnect ${NAME[platform]}?`)) return;
    await fetch(`/api/social/me/connect/${platform}`, { method: "DELETE" });
    await load();
  }

  if (!s?.enabled || !s.ready) return null;
  return (
    <section className="mt-8" aria-labelledby="social-h">
      <h2 id="social-h" className="text-lg font-semibold">Connected accounts</h2>
      <p className="mt-1 text-sm opacity-70">Share your songs to your own accounts. neo-fm never posts without you tapping share, and every post is labelled as AI music.</p>
      <ul className="mt-3 space-y-3">
        {s.platforms?.map((p) => (
          <li key={p.platform} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{NAME[p.platform]}{p.connected && p.label ? ` · ${p.label}` : ""}</div>
                <div className="text-xs opacity-70">{NOTE[p.route]}</div>
              </div>
              {p.connected ? (
                <button className="text-sm underline" onClick={() => disconnect(p.platform)}>Disconnect</button>
              ) : (
                <button className="rounded-sm border px-3 py-1 text-sm disabled:opacity-40" disabled={!p.neofm_app_ready} onClick={() => connect(p.platform, "neofm_app")}>Connect</button>
              )}
            </div>
            {!p.connected && s.own_app_allowed && (
              <div className="mt-2">
                <button className="text-xs underline" onClick={() => setOwn(own === p.platform ? null : p.platform)}>Use my own developer app</button>
                {own === p.platform && (
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="text-xs opacity-70">Add this redirect URL in your app: <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/social/callback/{p.platform}</code></p>
                    <input className="w-full rounded-sm border px-2 py-1" placeholder="Client ID" value={cid} onChange={(e) => setCid(e.target.value)} autoComplete="off" />
                    <input className="w-full rounded-sm border px-2 py-1" placeholder="Client secret" type="password" value={sec} onChange={(e) => setSec(e.target.value)} autoComplete="off" />
                    <button className="rounded-sm border px-3 py-1 disabled:opacity-40" disabled={!cid || !sec} onClick={() => connect(p.platform, "own_app")}>Save and connect</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
    </section>
  );
}
