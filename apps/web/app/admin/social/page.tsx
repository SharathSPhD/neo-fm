"use client";

/**
 * Publishing desk over /api/admin/social/*. Like /admin/health the page ships no data: the operator pastes the admin
 * secret (sessionStorage only) and it travels only in an Authorization header.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "neo-fm-ops-secret";
const PLATFORMS = ["youtube", "instagram", "facebook", "tiktok"] as const;

interface Post { id: string; platform: string; status: string; visibility: string; title: string; caption: string; needs_native_read: boolean; native_read_ok: boolean; external_url: string | null; error: string | null }
interface Account { platform: string; label: string }

export default function SocialPage() {
  const [secret, setSecret] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const call = useCallback(async (s: string, path: string, init?: RequestInit) => {
    const r = await fetch(path, { ...init, headers: { authorization: `Bearer ${s}`, "content-type": "application/json" }, cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ? `${body.error}${body.missing_env ? `: ${body.missing_env.join(", ")}` : ""}` : `Request failed (${r.status})`);
    return body;
  }, []);

  const load = useCallback(async (s: string) => {
    try {
      const d = await call(s, "/api/admin/social/queue");
      setPosts(d.posts);
      setAccounts(d.accounts);
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    }
  }, [call]);

  useEffect(() => {
    const s = sessionStorage.getItem(KEY) ?? "";
    setSecret(s);
    if (s) void load(s);
  }, [load]);

  const connect = async (p: string) => {
    try {
      const d = await call(secret, `/api/admin/social/connect/${p}`, { method: "POST" });
      window.location.href = d.url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    }
  };
  const act = async (body: object) => {
    try {
      await call(secret, "/api/admin/social/queue", { method: "POST", body: JSON.stringify(body) });
      await load(secret);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">Video publishing</h1>
      <input
        type="password" value={secret} placeholder="Admin secret" className="w-full rounded border p-2"
        onChange={(e) => { setSecret(e.target.value); sessionStorage.setItem(KEY, e.target.value); }}
        onBlur={() => secret && void load(secret)}
      />
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <section className="space-y-2">
        <h2 className="font-medium">Accounts</h2>
        {PLATFORMS.map((p) => {
          const a = accounts.find((x) => x.platform === p);
          return (
            <div key={p} className="flex items-center justify-between rounded border p-2">
              <span>{p}: {a ? `connected (${a.label})` : "not connected"}</span>
              <button className="rounded border px-3 py-1" onClick={() => void connect(p)}>{a ? "Reconnect" : "Connect"}</button>
            </div>
          );
        })}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Queue</h2>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paste S's approving words here before approving" className="w-full rounded border p-2" />
        {posts.length === 0 && <p className="text-sm opacity-70">Nothing queued.</p>}
        {posts.map((p) => (
          <div key={p.id} className="space-y-1 rounded border p-2 text-sm">
            <div className="font-medium">{p.platform}: {p.title} <span className="opacity-60">[{p.status}, {p.visibility}]</span></div>
            <pre className="whitespace-pre-wrap opacity-80">{p.caption}</pre>
            {p.needs_native_read && !p.native_read_ok && <p>Needs a native-speaker read of this caption.</p>}
            {p.error && <p className="text-red-600">{p.error}</p>}
            {p.external_url && <a className="underline" href={p.external_url}>Open</a>}
            {p.status === "draft" && (
              <div className="flex flex-wrap gap-2">
                <button className="rounded border px-3 py-1" onClick={() => void act({ action: "approve", id: p.id, approval_note: note, visibility: "private" })}>Approve (private)</button>
                <button className="rounded border px-3 py-1" onClick={() => void act({ action: "approve", id: p.id, approval_note: note, visibility: "public" })}>Approve (public)</button>
                {p.needs_native_read && <button className="rounded border px-3 py-1" onClick={() => void act({ action: "approve", id: p.id, approval_note: note, visibility: "private", native_read_ok: true })}>Approve, native read done</button>}
                <button className="rounded border px-3 py-1" onClick={() => void act({ action: "skip", id: p.id })}>Skip</button>
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
