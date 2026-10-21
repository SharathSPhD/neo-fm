import { describe, expect, it } from "vitest";

import { checkPromptGuard, watchedChanges } from "../../../scripts/prompt-guard-lib.mjs";

const exists = (p: string) => p === "tools/lyrics-lab/results/harness/kn_refs.md";
const run = (changed: string[], body: string) => checkPromptGuard({ changed, body, exists }) as { ok: boolean; watched: string[]; reason?: string; warning?: string };

describe("prompt guard", () => {
  it("ignores PRs that touch no prompt file", () => {
    expect(run(["apps/web/app/page.tsx"], "").ok).toBe(true);
  });
  it("flags polish, harness data and fixtures as watched", () => {
    expect(watchedChanges(["apps/web/lib/lyrics/polish.ts", "apps/web/lib/lyrics/harness/data/exemplars.json", "README.md"]).length).toBe(2);
  });
  it("fails a prompt change with no Eval-gate line", () => {
    const r = run(["apps/web/lib/lyrics/polish.ts"], "tweak wording");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no 'Eval-gate:'/);
  });
  it("accepts a repo file, a PR number or URL", () => {
    expect(run(["apps/web/lib/lyrics/polish.ts"], "x\nEval-gate: tools/lyrics-lab/results/harness/kn_refs.md#which-refs").ok).toBe(true);
    expect(run(["apps/web/lib/lyrics/polish.ts"], "Eval-gate: #432").ok).toBe(true);
    expect(run(["apps/web/lib/lyrics/polish.ts"], "Eval-gate: https://github.com/SharathSPhD/neo-fm/pull/432").ok).toBe(true);
  });
  it("rejects a reference that does not exist", () => {
    expect(run(["apps/web/lib/lyrics/polish.ts"], "Eval-gate: docs/made-up.md").ok).toBe(false);
  });
  it("allows a long enough exemption but warns", () => {
    const r = run(["apps/web/lib/lyrics/polish.ts"], "Eval-gate: exempt: comment-only change, no prompt text moves");
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/exempt/);
    expect(run(["apps/web/lib/lyrics/polish.ts"], "Eval-gate: exempt: typo").ok).toBe(false);
  });
});
