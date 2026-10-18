"use client";

/**
 * LibraryToolbar -- search box, filter dropdowns, sort, "favorites
 * only" toggle. All state is reflected in the URL search params so
 * the back button works, links are shareable, and the server-rendered
 * data matches the UI.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import type { UiKey } from "@/lib/i18n/ui-strings";

type Defaults = {
  q: string;
  style: string | null;
  lang: string | null;
  status: string | null;
  sort: string;
  favOnly: boolean;
  view: "grid" | "list";
};

export function LibraryToolbar({ defaults }: { defaults: Defaults }) {
  const { t } = useUiLang();
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
            {t("palette.search")}
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("lib.searchPlaceholder")}
            className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <Select
          label={t("prompt.style")}
          value={defaults.style ?? ""}
          options={[
            { v: "", l: "lib.o.allStyles" },
            { v: "carnatic", l: "lib.o.carnatic" },
            { v: "hindustani", l: "lib.o.hindustani" },
            { v: "kannada-folk", l: "lib.o.kannadaFolk" },
            { v: "western", l: "lib.o.western" },
          ]}
          onChange={(v) => update("style", v || null)}
        />
        <Select
          label={t("lang.label")}
          value={defaults.lang ?? ""}
          options={[
            { v: "", l: "lib.o.allLangs" },
            { v: "hi", l: "lib.o.hindi" },
            { v: "kn", l: "lib.o.kannada" },
            { v: "en", l: "lib.o.english" },
          ]}
          onChange={(v) => update("lang", v || null)}
        />
        <Select
          label={t("lib.f.status")}
          value={defaults.status ?? ""}
          options={[
            { v: "", l: "lib.o.anyStatus" },
            { v: "completed", l: "lib.o.completed" },
            { v: "processing", l: "lib.o.generating" },
            { v: "queued", l: "lib.o.queued" },
            { v: "failed", l: "lib.o.failed" },
          ]}
          onChange={(v) => update("status", v || null)}
        />
        <Select
          label={t("lib.f.sort")}
          value={defaults.sort}
          options={[
            { v: "newest", l: "lib.o.newest" },
            { v: "oldest", l: "lib.o.oldest" },
            { v: "duration_desc", l: "lib.o.longest" },
            { v: "duration_asc", l: "lib.o.shortest" },
            { v: "favorites", l: "lib.o.favFirst" },
          ]}
          onChange={(v) => update("sort", v)}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? "…" : t("lib.apply")}
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-foreground/60">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={defaults.favOnly}
              onChange={(e) => update("fav", e.target.checked ? "1" : null)}
            />
            {t("lib.favOnly")}
          </label>
          <div
            role="group"
            aria-label={t("lib.viewMode")}
            className="inline-flex items-center overflow-hidden rounded-md border border-muted/30"
          >
            <button
              type="button"
              aria-pressed={defaults.view === "grid"}
              onClick={() => update("view", defaults.view === "grid" ? null : "grid")}
              className={
                defaults.view === "grid"
                  ? "bg-accent/15 px-3 py-1.5 text-accent"
                  : "px-3 py-1.5 text-foreground/55 hover:text-foreground"
              }
            >
              ▦ {t("lib.grid")}
            </button>
            <button
              type="button"
              aria-pressed={defaults.view === "list"}
              onClick={() => update("view", "list")}
              className={
                defaults.view === "list"
                  ? "bg-accent/15 px-3 py-1.5 text-accent"
                  : "px-3 py-1.5 text-foreground/55 hover:text-foreground"
              }
            >
              ☰ {t("lib.list")}
            </button>
          </div>
        </div>
        {(defaults.q ||
          defaults.style ||
          defaults.lang ||
          defaults.status ||
          defaults.favOnly ||
          defaults.sort !== "newest") ? (
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
            {t("lib.clearFilters")}
          </button>
        ) : null}
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
  options: { v: string; l: UiKey }[];
  onChange: (v: string) => void;
}) {
  const { t } = useUiLang();
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
            {t(o.l)}
          </option>
        ))}
      </select>
    </label>
  );
}
