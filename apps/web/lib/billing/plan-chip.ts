/** /account plan chip: a Free-tier listener with an active Station pass sees only the pass badge, not a stale FREE chip. */
export function showPlanChip(plan: string, hasPass: boolean): boolean {
  return !(hasPass && plan === "Free");
}
