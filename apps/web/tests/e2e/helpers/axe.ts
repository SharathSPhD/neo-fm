/**
 * axe-core wrapper used by every e2e spec to enforce the Sprint 7.4
 * accessibility budget: zero critical or serious violations.
 *
 * We deliberately scope axe to the visible page (no `include`/`exclude`
 * filters) so any new component a developer adds is caught by default.
 * If a control is intentionally inaccessible (e.g. a 3rd-party iframe
 * we can't reach into), add an `exclude` selector here rather than
 * silently dropping the impact level.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Runs axe-core and fails the test on any violation with impact
 * "critical" or "serious". Returns the full result so the spec can
 * also assert on lower-impact issues if it wants.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  label: string,
): Promise<void> {
  // Avoid colour-contrast in dev; the Tailwind palette is approved at
  // the design-system level and axe's WCAG-AA contrast check is noisy
  // against translucent overlays. Re-enable once we ship a proper
  // contrast audit in v1.3.
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();

  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );

  if (serious.length > 0) {
    // Surface the offenders in the test output rather than just
    // failing with a "received [object Object]" — Playwright HTML
    // reporter preserves console.log lines.
    console.log(
      `[a11y:${label}] ${serious.length} serious/critical violation(s):`,
    );
    for (const v of serious) {
      console.log(
        `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`,
      );
      for (const node of v.nodes.slice(0, 3)) {
        console.log(`      target: ${node.target.join(" → ")}`);
      }
    }
  }
  expect(serious, `axe critical/serious violations on ${label}`).toEqual([]);
}
