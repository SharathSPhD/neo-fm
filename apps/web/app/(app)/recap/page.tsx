/** /recap[?month=YYYY-MM] -- "my month in music": a private, shareable summary of the signed-in user's month. */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentMonth, monthRange, previousMonth } from "@/lib/recap/compute";
import { loadRecap } from "@/lib/recap/load";
import { createServerClient } from "@/lib/supabase/server";

import { RecapView } from "./recap-view";

export const dynamic = "force-dynamic";

export default async function RecapPage({ searchParams }: { searchParams?: Promise<{ month?: string }> }) {
  const sp = (await searchParams) ?? {};
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/sign-in?next=/recap");

  const now = currentMonth();
  const range = monthRange(sp.month ?? now) ?? monthRange(now)!;
  const prev = previousMonth(range.month);
  const prevOk = prev ? monthRange(prev) : null;
  const next = range.month === now ? null : (() => {
    const [y, m] = range.month.split("-").map(Number);
    const d = new Date(Date.UTC(y!, m!, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  let recap = null;
  try {
    recap = await loadRecap(supabase as never, auth.user.id, range);
  } catch (e) {
    console.error("recap page failed", e instanceof Error ? e.message : e);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <nav className="flex items-center justify-between text-sm text-foreground/70" aria-label="Month">
        {prevOk ? (
          <Link className="underline-offset-4 hover:underline" href={`/recap?month=${prevOk.month}`}>
            ← {prevOk.month}
          </Link>
        ) : <span />}
        {next ? (
          <Link className="underline-offset-4 hover:underline" href={`/recap?month=${next}`}>
            {next} →
          </Link>
        ) : <span />}
      </nav>
      {recap ? (
        <RecapView recap={recap} month={range.month} />
      ) : (
        <p className="text-sm text-foreground/70">Couldn&apos;t build your recap right now. Try again in a moment.</p>
      )}
    </div>
  );
}
