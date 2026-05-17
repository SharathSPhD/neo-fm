"use client";

import type { Language } from "@neo-fm/song-doc";
import { useEffect, useMemo, useState } from "react";

// v1.4 Sprint 6: a single source of truth for "<Language name> · <Script
// name>" labels. The old code hand-rolled three branches and silently
// fell back to "English · Latin script" for any unknown language — which
// landed Tamil / Bengali / Telugu / Sanskrit users on a misleading label.
// Centralising this here keeps the picker honest as new languages ship.
const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English · Latin script",
  hi: "Hindi · Devanagari",
  kn: "Kannada · Kannada script",
  ta: "Tamil · Tamil script",
  bn: "Bengali · Bengali script",
  te: "Telugu · Telugu script",
  sa: "Sanskrit · Devanagari",
};

function languageLabel(language: Language): string {
  // Exhaustive: typecheck enforces every Language key. The fallback is a
  // defensive belt-and-braces in case the union grows ahead of this map.
  return LANGUAGE_LABELS[language] ?? language;
}

/**
 * M2 library picker side panel.
 *
 * Slides in when the user clicks "Pick from library" on a section. Lists
 * public-domain lyrics from the bundled corpus filtered by language, and
 * lets the user paste the full body into the active section by clicking
 * "Use this lyric". Source citation and PD assertion are shown alongside
 * so the user knows where the words came from.
 *
 * Data source: GET /api/lyrics?language=<lang> for the listing,
 * GET /api/lyrics/<id> for the full body. Both auth-gated.
 */

interface LyricSummary {
  id: string;
  title: string;
  author: string;
  language: Language;
  script: string;
  snippet: string;
  source_url: string;
  source_citation: string;
}

interface LibraryPickerProps {
  language: Language;
  open: boolean;
  onClose: () => void;
  /**
   * Called with the full body when the user picks an entry. The parent
   * is responsible for finding the active section and dropping the body
   * into its `lyrics` field. We don't reach across the canvas state.
   */
  onPick: (entry: { id: string; body: string; script: string }) => void;
}

export function LibraryPicker({
  language,
  open,
  onClose,
  onPick,
}: LibraryPickerProps) {
  const [items, setItems] = useState<LyricSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/lyrics?language=${encodeURIComponent(language)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${(await r.text()) || "(no body)"}`);
        }
        return (await r.json()) as { items: LyricSummary[] };
      })
      .then((body) => {
        if (cancelled) return;
        setItems(body.items);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, language]);

  // Group entries by author for a friendlier display.
  const grouped = useMemo(() => {
    const map = new Map<string, LyricSummary[]>();
    for (const item of items) {
      const list = map.get(item.author) ?? [];
      list.push(item);
      map.set(item.author, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  if (!open) return null;

  async function pick(item: LyricSummary) {
    setPicking(item.id);
    try {
      const res = await fetch(
        `/api/lyrics/${encodeURIComponent(item.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const body = (await res.json()) as {
        id: string;
        body: string;
        script: string;
      };
      onPick({ id: body.id, body: body.body, script: body.script });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(null);
    }
  }

  return (
    <aside
      aria-label="Lyric library"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-muted/30 bg-background px-5 py-6 shadow-xl"
    >
      <header className="mb-4 flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-base font-medium">Public-domain lyric library</h2>
          <p className="text-[11px] text-foreground/50">
            {languageLabel(language)}
            {" · "}
            All entries verified PD in India & US (see source citation).
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close library"
          className="rounded-md border border-muted/30 px-2 py-1 text-xs text-foreground/70 hover:text-foreground"
        >
          Close
        </button>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-foreground/50">Loading...</p>
      ) : null}

      {!loading && grouped.length === 0 && !error ? (
        <p className="text-sm text-foreground/50">
          No lyrics available for this language yet.
        </p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {grouped.map(([author, entries]) => (
          <li key={author} className="flex flex-col gap-2">
            <h3 className="text-[10px] uppercase tracking-widest text-foreground/40">
              {author}
            </h3>
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-md border border-muted/30 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{entry.title}</span>
                    <button
                      type="button"
                      onClick={() => pick(entry)}
                      disabled={picking === entry.id}
                      className="shrink-0 rounded-md border border-accent/30 px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50"
                    >
                      {picking === entry.id ? "Loading..." : "Use this lyric"}
                    </button>
                  </div>
                  <p className="font-serif text-xs leading-relaxed text-foreground/80">
                    {entry.snippet}
                  </p>
                  <a
                    href={entry.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[10px] text-foreground/40 underline-offset-2 hover:text-foreground/70 hover:underline"
                    title={entry.source_citation}
                  >
                    Source
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}
