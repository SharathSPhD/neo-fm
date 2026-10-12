"use client";

import { useState } from "react";

const QUESTIONS = [
  { key: "lyric_quality", label: "Lyrics: do they read like good writing in this language?" },
  { key: "pronunciation", label: "Pronunciation: are the words sung clearly and correctly?" },
  { key: "prosody", label: "Prosody: do the words fit the melody and rhythm naturally?" },
  { key: "cultural_fit", label: "Cultural fit: do the imagery and tone feel right?" },
] as const;

type Key = (typeof QUESTIONS)[number]["key"];
export interface Initial extends Record<Key, number> { sounds_native: boolean; comment: string | null }

export function RatingForm({ token, itemId, initial }: { token: string; itemId: string; initial: Initial | null }) {
  const [scores, setScores] = useState<Partial<Record<Key, number>>>(initial ?? {});
  const [native, setNative] = useState<boolean | null>(initial?.sounds_native ?? null);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(initial ? "saved" : "idle");
  const complete = QUESTIONS.every((q) => scores[q.key]) && native !== null;

  async function save() {
    setState("saving");
    const res = await fetch(`/api/native-review/${token}/ratings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_id: itemId, ...scores, sounds_native: native, comment: comment.trim() || undefined }),
    }).catch(() => null);
    setState(res?.ok ? "saved" : "error");
  }

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) void save();
      }}
    >
      {QUESTIONS.map((q) => (
        <fieldset key={q.key}>
          <legend className="text-sm">{q.label}</legend>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="text-foreground/50">Poor</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex items-center gap-1">
                <input type="radio" name={`${itemId}-${q.key}`} value={n} checked={scores[q.key] === n} onChange={() => { setScores({ ...scores, [q.key]: n }); setState("idle"); }} />
                {n}
              </label>
            ))}
            <span className="text-foreground/50">Excellent</span>
          </div>
        </fieldset>
      ))}
      <fieldset>
        <legend className="text-sm">Does it sound like something a native speaker would sing?</legend>
        <div className="mt-1 flex gap-4 text-sm">
          {([true, false] as const).map((v) => (
            <label key={String(v)} className="flex items-center gap-1">
              <input type="radio" name={`${itemId}-native`} checked={native === v} onChange={() => { setNative(v); setState("idle"); }} />
              {v ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        Anything we should fix? (optional, up to 500 characters)
        <textarea
          className="mt-1 w-full rounded-md border border-muted/30 bg-transparent p-2"
          rows={3}
          maxLength={500}
          value={comment}
          onChange={(e) => { setComment(e.target.value); setState("idle"); }}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!complete || state === "saving"} className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">
          {state === "saved" ? "Update rating" : "Save rating"}
        </button>
        <span role="status" className="text-sm text-foreground/60">
          {state === "saved" ? "Saved. Thank you." : state === "error" ? "Could not save. Please try again." : !complete ? "Answer every question to save." : ""}
        </span>
      </div>
    </form>
  );
}
