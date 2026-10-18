"use client";

import { useMemo, useState } from "react";

import type { ReviewLang, ReviewSection } from "@/lib/ui-review/core";

export type Verdict = { action: "approve" | "edit"; suggestion: string; comment: string };
export type Verdicts = Record<string, Verdict>;
type Filter = "todo" | "all" | "approved" | "edited";
type RowState = "idle" | "saving" | "saved" | "error";

const PLACEHOLDER = /\{\w+\}|\[\[|\]\]/g;
const tokensOf = (s: string) => (s.match(PLACEHOLDER) ?? []).slice().sort().join("|");

export function ReviewClient({
  token,
  lang,
  sections,
  initial,
}: {
  token: string;
  lang: ReviewLang;
  sections: ReviewSection[];
  initial: Verdicts;
}) {
  const [verdicts, setVerdicts] = useState<Verdicts>(initial);
  const [filter, setFilter] = useState<Filter>("todo");
  const [query, setQuery] = useState("");
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const done = Object.keys(verdicts).length;
  const edited = Object.values(verdicts).filter((v) => v.action === "edit").length;
  const q = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      sections
        .map((s) => ({
          ...s,
          rows: s.rows.filter((r) => {
            const v = verdicts[r.key];
            if (filter === "todo" && v) return false;
            if (filter === "approved" && v?.action !== "approve") return false;
            if (filter === "edited" && v?.action !== "edit") return false;
            return !q || `${r.key} ${r.en} ${r.current}`.toLowerCase().includes(q);
          }),
        }))
        .filter((s) => s.rows.length > 0),
    [sections, verdicts, filter, q],
  );

  async function send(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/ui-review/${token}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    return !!res?.ok;
  }

  return (
    <div className="mt-8">
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-3 border-b border-muted/30 bg-background/95 px-2 py-3 backdrop-blur">
        <p role="status" className="text-sm" data-testid="progress">
          <strong>{done}</strong> of {total} reviewed ({edited} edited)
        </p>
        <progress className="h-2 w-40" value={done} max={total} aria-label="Review progress" />
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <select
            aria-label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="rounded-md border border-muted/40 bg-background px-2 py-1"
          >
            <option value="todo">Not reviewed yet</option>
            <option value="all">All strings</option>
            <option value="approved">Approved as-is</option>
            <option value="edited">My edits</option>
          </select>
          <input
            type="search"
            aria-label="Search strings"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-40 rounded-md border border-muted/40 bg-transparent px-2 py-1"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-10 text-foreground/60">
          {filter === "todo" && !q ? "Everything is reviewed. Thank you!" : "No strings match."}
        </p>
      ) : (
        visible.map((s) => (
          <section key={s.id} aria-labelledby={`sec-${s.id}`} className="mt-10">
            <h2 id={`sec-${s.id}`} className="text-lg font-medium">
              {s.label}
              {s.path ? (
                <>
                  {" "}
                  <a
                    href={`/ui-review/${token}/open?path=${encodeURIComponent(s.path)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-sm font-normal text-accent underline"
                  >
                    See this screen in {lang}
                  </a>
                </>
              ) : null}
            </h2>
            <ul className="mt-3 space-y-4">
              {s.rows.map((r) => (
                <Row
                  key={r.key}
                  lang={lang}
                  row={r}
                  verdict={verdicts[r.key]}
                  onSend={send}
                  onChange={(v) =>
                    setVerdicts((all) => {
                      const next = { ...all };
                      if (v) next[r.key] = v;
                      else delete next[r.key];
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function Row({
  lang,
  row,
  verdict,
  onSend,
  onChange,
}: {
  lang: ReviewLang;
  row: { key: string; en: string; current: string };
  verdict: Verdict | undefined;
  onSend: (body: Record<string, unknown>) => Promise<boolean>;
  onChange: (v: Verdict | null) => void;
}) {
  const [text, setText] = useState(verdict?.action === "edit" ? verdict.suggestion : row.current);
  const [comment, setComment] = useState(verdict?.comment ?? "");
  const [state, setState] = useState<RowState>("idle");
  const changed = text.trim() !== row.current.trim();
  const phOk = tokensOf(text) === tokensOf(row.en);
  const status = verdict ? (verdict.action === "approve" ? "Approved" : "Edited") : "Not reviewed";

  async function save(action: "approve" | "edit") {
    setState("saving");
    const ok = await onSend({
      key: row.key,
      action,
      suggestion: action === "edit" ? text : undefined,
      comment: comment.trim() || undefined,
    });
    setState(ok ? "saved" : "error");
    if (ok) onChange({ action, suggestion: action === "edit" ? text.trim() : "", comment: comment.trim() });
  }

  async function clear() {
    setState("saving");
    const ok = await onSend({ key: row.key, action: "clear" });
    setState(ok ? "idle" : "error");
    if (ok) {
      onChange(null);
      setText(row.current);
      setComment("");
    }
  }

  return (
    <li className="rounded-lg border border-muted/30 p-4" data-testid="review-row">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/50">
        <code>{row.key}</code>
        <span className={verdict ? "text-accent" : ""}>{status}</span>
      </div>
      <p className="mt-2 text-sm text-foreground/60">English</p>
      <p className="whitespace-pre-line">{row.en}</p>
      <p className="mt-3 text-sm text-foreground/60">Current {lang} translation</p>
      <p lang={lang} className="whitespace-pre-line">
        {row.current}
      </p>
      <label className="mt-3 block text-sm text-foreground/60">
        Your version
        <textarea
          aria-label="Your version"
          lang={lang}
          rows={Math.min(6, Math.max(2, Math.ceil(row.current.length / 60)))}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setState("idle");
          }}
          className="mt-1 w-full rounded-md border border-muted/30 bg-transparent p-2 text-base text-foreground"
        />
      </label>
      {!phOk ? (
        <p role="alert" className="mt-1 text-xs text-red-300">
          Keep the {"{placeholders}"} and [[ ]] markers exactly as in the English.
        </p>
      ) : null}
      <label className="mt-2 block text-sm text-foreground/60">
        Note (optional)
        <input
          value={comment}
          maxLength={500}
          onChange={(e) => {
            setComment(e.target.value);
            setState("idle");
          }}
          className="mt-1 w-full rounded-md border border-muted/30 bg-transparent px-2 py-1 text-foreground"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => save("approve")}
          disabled={state === "saving" || changed}
          title={changed ? "You changed the text: save it as an edit instead" : undefined}
          className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent disabled:opacity-50"
        >
          Looks good
        </button>
        <button
          type="button"
          onClick={() => save("edit")}
          disabled={state === "saving" || !changed || !phOk || !text.trim()}
          className="rounded-md border border-muted/40 px-3 py-1.5 disabled:opacity-50"
        >
          Save my edit
        </button>
        {verdict ? (
          <button type="button" onClick={clear} disabled={state === "saving"} className="px-2 py-1.5 text-foreground/60 underline">
            Undo
          </button>
        ) : null}
        <span role="status" className="text-foreground/60">
          {state === "saved" ? "Saved." : state === "error" ? "Could not save. Please try again." : ""}
        </span>
      </div>
    </li>
  );
}
