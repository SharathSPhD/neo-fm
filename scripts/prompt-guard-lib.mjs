// Prompt guard: a PR that changes a production lyric prompt must point at its eval-gate evidence.
// Pure functions so the rule is unit-tested (apps/web/tests/prompt-guard.test.ts); scripts/prompt-guard.mjs is the CI wrapper.

/** Files whose text reaches a production model call about lyrics, diction or their selection. Directory entries end with "/". */
export const WATCHED = [
  "apps/web/lib/lyrics/polish.ts",
  "apps/web/lib/lyrics/premium.ts",
  "apps/web/lib/lyrics/meaning.ts",
  "apps/web/lib/lyrics/harness/",
  "apps/web/lib/diction/claude-roman.ts",
  "apps/web/lib/diction/index.ts",
  "apps/web/lib/agent/definitions.ts",
  "apps/web/lib/agent/skill-pce-poem.ts",
  "apps/web/lib/engine/judge.ts",
  "managed-agents/pce-engine/pce/",
  "apps/web/tests/fixtures/prompt-regression/",
];

export const watchedChanges = (changed) => changed.filter((f) => WATCHED.some((w) => (w.endsWith("/") ? f.startsWith(w) : f === w)));

const REPO_URL = /^https:\/\/github\.com\/SharathSPhD\/neo-fm\/(pull|issues)\/\d+\b/;

/**
 * Returns { ok, watched, reason, warning }. An "Eval-gate:" line in the PR body must name (a) a file in the repo, (b) a PR or issue
 * of this repo (URL or #N), or (c) "exempt: <reason>" for changes that cannot alter model input (the exemption is reported as a warning
 * so a reviewer sees it).
 */
export function checkPromptGuard({ changed, body, exists }) {
  const watched = watchedChanges(changed);
  if (watched.length === 0) return { ok: true, watched };
  const line = (body ?? "").split("\n").map((l) => l.trim()).find((l) => /^eval[- ]gate\s*:/i.test(l));
  if (!line) return { ok: false, watched, reason: "no 'Eval-gate:' line in the PR description" };
  const ref = line.replace(/^eval[- ]gate\s*:\s*/i, "").trim().replace(/^[`<(\[]+|[`>)\]]+$/g, "");
  if (/^exempt\b/i.test(ref)) {
    const why = ref.replace(/^exempt\s*[:\-—]?\s*/i, "");
    return why.length >= 20 ? { ok: true, watched, warning: `exempt: ${why}` } : { ok: false, watched, reason: "'exempt' needs a reason of at least 20 characters" };
  }
  if (REPO_URL.test(ref) || /^#\d+$/.test(ref)) return { ok: true, watched };
  const path = ref.split("#")[0];
  if (path && !/\s/.test(path) && exists(path)) return { ok: true, watched };
  return { ok: false, watched, reason: `'${ref}' is not a file in this repo, a PR/issue of this repo, or an exemption` };
}
