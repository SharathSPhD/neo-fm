"use client";

/**
 * LibraryToolbar -- search box, filter dropdowns, sort, "favorites
 * only" toggle. All state is reflected in the URL search params so
 * the back button works, links are shareable, and the server-rendered
 * data matches the UI.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

type Defaults = {
  q: string;
  style: string | null;
  lang: string | null;
  status: string | null;
  sort: string;
  favOnly: boolean;
};

export function LibraryToolbar({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(defaults.q);

  function navigate(next: URLSearchParams) {
    next.delete("page");
    startTransition(() => {
      router.replace(`/library?${next.toString()}`);
    });
  }

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value == null || value === "") next.delete(key);
    else next.set(key, value);
    navigate(next);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    update("q", q || null);
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-muted/20 bg-muted/5 px-4 py-3">
      <form
        onSubmit={submitSearch}
        className="flex flex-wrap items-end gap-3"
        role="search"
      >
        <label className="flex flex-1 min-w-[14rem] flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-foreground/40">
            Search
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles…"
            className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <Select
          label="Style"
          value={defaults.style ?? ""}
          options={[
            { v: "", l: "All styles" },
            { v: "carnatic", l: "Carnatic" },
            { v: "hindustani", l: "Hindustani" },
            { v: "kannada-folk", l: "Kannada folk" },
            { v: "western", l: "Western" },
          ]}
          onChange={(v) => update("style", v || null)}
        />
        <Select
          label="Language"
          value={defaults.lang ?? ""}
          options={[
            { v: "", l: "All languages" },
            { v: "hi", l: "Hindi" },
            { v: "kn", l: "Kannada" },
            { v: "en", l: "English" },
          ]}
          onChange={(v) => update("lang", v || null)}
        />
        <Select
          label="Status"
          value={defaults.status ?? ""}
          options={[
            { v: "", l: "Any status" },
            { v: "completed", l: "Completed" },
            { v: "processing", l: "Generating" },
            { v: "queued", l: "Queued" },
            { v: "failed", l: "Failed" },
          ]}
          onChange={(v) => update("status", v || null)}
        />
        <Select
          label="Sort"
          value={defaults.sort}
          options={[
            { v: "newest", l: "Newest first" },
            { v: "oldest", l: "Oldest first" },
            { v: "duration_desc", l: "Longest first" },
            { v: "duration_asc", l: "Shortest first" },
            { v: "favorites", l: "Favorites first" },
          ]}
          onChange={(v) => update("sort", v)}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? "…" : "Apply"}
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-foreground/60">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={defaults.favOnly}
            onChange={(e) => update("fav", e.target.checked ? "1" : null)}
          />
          Favorites only
        </label>
        {(defaults.q ||
          defaults.style ||
          defaults.lang ||
          defaults.status ||
          defaults.favOnly ||
          defaults.sort !== "newest") && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              startTransition(() => {
                router.replace("/library");
              });
            }}
            className="text-foreground/60 underline hover:text-foreground"
          >
            Clear all filters
          </button>
        )}
      </div>
    </section>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-foreground/40">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}
