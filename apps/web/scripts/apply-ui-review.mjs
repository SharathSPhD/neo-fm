#!/usr/bin/env node
/**
 * Apply an approved UI-translation review patch to the locale files.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP/api/admin/ui-review?action=patch&lang=kn" > kn.patch.json
 *   node apps/web/scripts/apply-ui-review.mjs kn.patch.json [--mark-reviewed]
 *
 * Then review `git diff` and open a PR. --mark-reviewed flips TRANSLATION_STATUS for the language only when every key
 * was approved or edited by a reviewer (patch.complete). The logic mirrors lib/ui-review/core.ts (applyEditsToSource,
 * markReviewed), which is unit-tested.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , patchPath, ...flags] = process.argv;
if (!patchPath) {
  console.error("usage: apply-ui-review.mjs <patch.json> [--mark-reviewed]");
  process.exit(2);
}
const patch = JSON.parse(readFileSync(patchPath, "utf8"));
if (!/^(hi|ta|te|kn|bn)$/.test(patch.language)) throw new Error(`bad language: ${patch.language}`);

const file = join(root, "lib/i18n/locales", `${patch.language}.ts`);
let src = readFileSync(file, "utf8");
for (const e of patch.edits) {
  const prefix = `  ${JSON.stringify(e.key)}: `;
  const start = src.indexOf(`\n${prefix}`);
  if (start < 0) throw new Error(`key not found in ${patch.language}.ts: ${e.key}`);
  if (!src.slice(start + 1).startsWith(`${prefix}${JSON.stringify(e.old)},`)) {
    throw new Error(`current text for ${e.key} no longer matches the reviewed version; regenerate the patch`);
  }
  const lineStart = start + 1;
  src = src.slice(0, lineStart) + `${prefix}${JSON.stringify(e.new)},` + src.slice(src.indexOf("\n", lineStart));
}
writeFileSync(file, src);
console.log(`${patch.language}: applied ${patch.edits.length} edits`);

if (flags.includes("--mark-reviewed")) {
  if (!patch.complete) {
    console.error(`not marking ${patch.language} reviewed: ${patch.total_keys - patch.edits.length - patch.approved_keys.length} keys have no review yet`);
    process.exit(1);
  }
  const f = join(root, "lib/i18n/ui-strings.ts");
  const s = readFileSync(f, "utf8");
  const re = new RegExp(`(\\n\\s+${patch.language}: )"pending-review"`);
  if (!re.test(s)) throw new Error(`status for ${patch.language} is not pending-review`);
  writeFileSync(f, s.replace(re, '$1"reviewed"'));
  console.log(`${patch.language}: marked reviewed`);
}
