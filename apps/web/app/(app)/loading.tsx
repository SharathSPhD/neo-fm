/**
 * Default loading skeleton for every authed page. Individual pages may
 * provide their own `loading.tsx` for a more specific skeleton.
 */
export default function AppGroupLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-9 w-48 animate-pulse rounded bg-muted/30" />
      <div className="h-4 w-64 animate-pulse rounded bg-muted/20" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-xl border border-muted/30 bg-muted/15"
          />
        ))}
      </div>
    </div>
  );
}
