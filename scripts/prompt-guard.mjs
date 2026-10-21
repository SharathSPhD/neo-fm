#!/usr/bin/env node
// CI wrapper: node scripts/prompt-guard.mjs <base-ref>   (PR body in $PR_BODY)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { checkPromptGuard } from "./prompt-guard-lib.mjs";

const base = process.argv[2] ?? "origin/main";
const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
const r = checkPromptGuard({ changed, body: process.env.PR_BODY ?? "", exists: (p) => existsSync(p) });
if (r.watched.length === 0) { console.log("prompt-guard: no production prompt files changed"); process.exit(0); }
console.log("prompt-guard: production prompt files changed:\n  " + r.watched.join("\n  "));
if (r.warning) console.log(`::warning::prompt-guard ${r.warning}`);
if (!r.ok) {
  console.error(`::error::prompt-guard: ${r.reason}. Production prompts change only through the eval gate: add a line to the PR description, e.g.\nEval-gate: tools/lyrics-lab/results/harness/<gate-result>.md  (or a PR/issue URL, or: Eval-gate: exempt: <reason, 20+ chars>)`);
  process.exit(1);
}
console.log("prompt-guard: eval-gate reference accepted");
