export default function MarketingLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-24">
      <div className="h-12 w-2/3 animate-pulse rounded bg-muted/30" />
      <div className="mt-4 h-6 w-1/2 animate-pulse rounded bg-muted/20" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-muted/30 bg-muted/15"
          />
        ))}
      </div>
    </div>
  );
}
