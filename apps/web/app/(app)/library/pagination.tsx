"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function Pagination({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function go(page: number) {
    const next = new URLSearchParams(params.toString());
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    router.replace(`/library?${next.toString()}`);
  }

  return (
    <nav
      aria-label="Library pagination"
      className="flex items-center justify-center gap-2 pt-2 text-sm"
    >
      <button
        type="button"
        onClick={() => go(current - 1)}
        disabled={current <= 1}
        className="rounded-md border border-muted/30 px-3 py-1.5 text-foreground/80 transition hover:border-accent/40 disabled:opacity-40"
      >
        ← Prev
      </button>
      <span className="px-3 text-foreground/60">
        Page {current} of {total}
      </span>
      <button
        type="button"
        onClick={() => go(current + 1)}
        disabled={current >= total}
        className="rounded-md border border-muted/30 px-3 py-1.5 text-foreground/80 transition hover:border-accent/40 disabled:opacity-40"
      >
        Next →
      </button>
    </nav>
  );
}
