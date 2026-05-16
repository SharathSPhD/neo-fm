"use client";

/**
 * Global ⌘K / Ctrl+K command palette.
 *
 * Mounted once from the authed app shell. Listens for the platform-correct
 * keyboard shortcut to open, and offers three groups:
 *
 *   - Navigate     -- top-level routes (Library, Discover, New song, Pricing,
 *                     Account).
 *   - Recent songs -- the user's last 10 jobs, fetched from /api/songs on
 *                     first open and cached for the rest of the session.
 *   - Help         -- /help and /pricing for surface-level discovery.
 *
 * Selecting an item closes the palette and navigates via Next's client
 * router so the page transitions stay smooth.
 *
 * a11y notes
 *   - cmdk handles roving focus, ARIA listbox semantics, and the typeahead
 *     filter internally.
 *   - We restore focus to whatever element triggered the palette when it
 *     closes (a small QoL win for keyboard-first users).
 *   - The trigger pill in <app-shell.tsx> shows the active shortcut so the
 *     feature is discoverable without docs.
 */
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type RecentSong = {
  id: string;
  title: string | null;
  status: string;
  style_family: string | null;
};

type ApiResponse = {
  items?: {
    id: string;
    status: string;
    song_document: {
      title: string | null;
      style_family: string | null;
    } | null;
  }[];
};

function isMac(): boolean {
  if (typeof window === "undefined") return false;
  return /Mac|iPhone|iPod|iPad/i.test(window.navigator.userAgent);
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentSong[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Open with ⌘K (mac) or Ctrl+K (everywhere else).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = isMac() ? e.metaKey : e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setOpen((prev) => {
        if (!prev && typeof document !== "undefined") {
          triggerRef.current = document.activeElement as HTMLElement | null;
        }
        return !prev;
      });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Restore focus to the trigger when the palette closes.
  useEffect(() => {
    if (open) return;
    const el = triggerRef.current;
    if (el && typeof el.focus === "function") {
      el.focus();
    }
  }, [open]);

  // Lazy-load recent songs the first time the palette opens.
  useEffect(() => {
    if (!open) return;
    if (recent !== null) return;
    if (recentLoading) return;
    setRecentLoading(true);
    fetch("/api/songs?limit=10", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<ApiResponse>) : null))
      .then((data) => {
        if (!data?.items) {
          setRecent([]);
          return;
        }
        setRecent(
          data.items.map((it) => ({
            id: it.id,
            title: it.song_document?.title ?? null,
            status: it.status,
            style_family: it.song_document?.style_family ?? null,
          })),
        );
      })
      .catch(() => setRecent([]))
      .finally(() => setRecentLoading(false));
  }, [open, recent, recentLoading]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const shortcutHint = useMemo(() => (isMac() ? "⌘K" : "Ctrl+K"), []);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 p-4 backdrop-blur-sm sm:pt-24"
    >
      <div
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className="absolute inset-0"
      />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-muted/40 bg-background/95 shadow-xl">
        <div className="flex items-center gap-3 border-b border-muted/30 px-4 py-3">
          <span aria-hidden className="text-sm text-foreground/50">
            ▸
          </span>
          <Command.Input
            placeholder="Search or jump to…"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
          <kbd className="rounded border border-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/60">
            esc
          </kbd>
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-foreground/55">
            No matches. Press {shortcutHint} again to close.
          </Command.Empty>

          <Command.Group heading="Navigate" className="text-xs uppercase tracking-wider text-foreground/50">
            <PaletteItem onSelect={() => go("/library")} label="Library" hint="L" />
            <PaletteItem onSelect={() => go("/discover")} label="Discover" hint="D" />
            <PaletteItem onSelect={() => go("/songs/new")} label="New song" hint="N" />
            <PaletteItem onSelect={() => go("/pricing")} label="Pricing" hint="P" />
            <PaletteItem onSelect={() => go("/account")} label="Account" hint="A" />
            <PaletteItem onSelect={() => go("/help")} label="Help" hint="?" />
          </Command.Group>

          <Command.Group
            heading={
              recentLoading
                ? "Recent songs (loading…)"
                : "Recent songs"
            }
            className="mt-1 text-xs uppercase tracking-wider text-foreground/50"
          >
            {(recent ?? []).slice(0, 10).map((s) => (
              <PaletteItem
                key={s.id}
                onSelect={() => go(`/songs/${s.id}`)}
                label={s.title?.trim() || `Song · ${s.id.slice(0, 8)}`}
                sub={
                  s.style_family
                    ? `${s.status} · ${s.style_family}`
                    : s.status
                }
              />
            ))}
            {recent !== null && recent.length === 0 ? (
              <Command.Item
                disabled
                className="rounded-md px-3 py-2 text-sm text-foreground/45"
              >
                No songs yet. Hit “New song” to start.
              </Command.Item>
            ) : null}
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}

function PaletteItem({
  onSelect,
  label,
  sub,
  hint,
}: {
  onSelect: () => void;
  label: string;
  sub?: string;
  hint?: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-foreground/85 aria-selected:bg-muted/30 aria-selected:text-foreground"
    >
      <span className="flex flex-col">
        <span>{label}</span>
        {sub ? (
          <span className="text-xs text-foreground/50">{sub}</span>
        ) : null}
      </span>
      {hint ? (
        <kbd className="rounded border border-muted/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/55">
          {hint}
        </kbd>
      ) : null}
    </Command.Item>
  );
}
