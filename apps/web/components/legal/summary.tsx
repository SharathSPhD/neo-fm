/** Plain-language box at the top of each legal page. Keep it to a handful of short, true sentences; the detail lives below it. */
export function PlainSummary({ points }: { points: readonly string[] }) {
  return (
    <aside aria-labelledby="plain-summary" className="mt-6 rounded-lg border border-muted/30 bg-foreground/[0.03] p-5">
      <h2 id="plain-summary" className="text-sm font-medium uppercase tracking-widest text-foreground/60">In plain language</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-foreground/80">
        {points.map((p) => <li key={p}>{p}</li>)}
      </ul>
      <p className="mt-3 text-xs text-foreground/50">This summary is a guide, not a substitute for the full text below.</p>
    </aside>
  );
}
