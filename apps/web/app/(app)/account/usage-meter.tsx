import {
  isEffectivelyUnlimited,
  nextMonthlyReset,
  summarizeUsage,
} from "@/lib/billing/usage";

/** Songs left this month plus the date the monthly allowance (songs and Lyria render budget) resets. */
export function UsageMeter({ quota, used }: { quota: number; used: number }) {
  const reset = nextMonthlyReset().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  if (isEffectivelyUnlimited(quota)) {
    return (
      <p className="text-xs text-foreground/60">
        No monthly song limit on your plan. Allowance resets on {reset}.
      </p>
    );
  }
  const s = summarizeUsage(quota, used);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span>
          <strong className="font-medium">{s.left}</strong> of {s.quota} songs left this month
        </span>
        <span className="text-xs text-foreground/50">resets {reset}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Songs used this month"
        aria-valuemin={0}
        aria-valuemax={s.quota}
        aria-valuenow={Math.min(s.used, s.quota)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/20"
      >
        <div
          className={`h-full rounded-full ${s.left === 0 ? "bg-red-400" : "bg-accent"}`}
          style={{ width: `${Math.round(s.fraction * 100)}%` }}
        />
      </div>
      <p className="text-xs text-foreground/50">
        Longer songs use more of your monthly render budget, so you may reach it before the song count.
      </p>
    </div>
  );
}
