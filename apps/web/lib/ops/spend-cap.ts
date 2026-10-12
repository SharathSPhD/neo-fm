/** Monthly Lyria ceiling across all users. One definition so the ops views and spendGuard() cannot drift apart. */
export const LYRIA_BUDGET_DEFAULT_GBP = 3;

export function lyriaBudgetGbp(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LYRIA_BUDGET_GBP ?? LYRIA_BUDGET_DEFAULT_GBP);
  return Number.isFinite(n) ? n : LYRIA_BUDGET_DEFAULT_GBP;
}
