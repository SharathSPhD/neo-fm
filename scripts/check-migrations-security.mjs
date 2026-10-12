#!/usr/bin/env node
// Static security lint for infra/supabase/migrations/*.sql (run in CI: `node scripts/check-migrations-security.mjs`).
// Rules (see docs/SECURITY-THREAT-MODEL.md):
//   rls         every table created in schema public has `enable row level security`
//   search-path every SECURITY DEFINER function (latest definition) sets search_path
//   fn-revoke   every SECURITY DEFINER function has `revoke execute ... from public|anon`
//   view-revoke every public view has `revoke ... on <view> from anon` (Supabase grants ALL on new views, and an
//               owner-run auto-updatable view with write grants lets clients write the base table, bypassing RLS)
// Known gaps that a later migration already fixed in prod but that this static check cannot see are listed in
// scripts/check-migrations-security.allow.json with a reason. New violations must be fixed, not allow-listed.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] ?? join(root, "infra/supabase/migrations");
const allowPath = process.argv[3] ?? join(root, "scripts/check-migrations-security.allow.json");

const strip = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    // function bodies: keep headers (where search_path / security definer live), drop bodies so `;` inside split correctly
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "$$$$");

const ident = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const stmts = [];
for (const f of files) {
  for (const s of strip(readFileSync(join(dir, f), "utf8")).split(";")) {
    const t = s.replace(/\s+/g, " ").trim().toLowerCase();
    if (t) stmts.push({ file: f, sql: t });
  }
}

const tables = new Map(); // name -> file
const rls = new Set();
const fns = new Map(); // name -> {file, definer, searchPath}
const views = new Map(); // name -> file
const fnRevoked = new Set();
const viewRevoked = new Set();

for (const { file, sql } of stmts) {
  let m;
  if ((m = sql.match(new RegExp(`^create (?:unlogged )?table (?:if not exists )?${ident} `)))) {
    if (!/^create (?:unlogged )?table (?:if not exists )?"?(?!public\.)[a-z_]+"?\./.test(sql)) tables.set(m[1], file);
  } else if ((m = sql.match(new RegExp(`^drop table (?:if exists )?${ident}`)))) {
    tables.delete(m[1]);
  } else if ((m = sql.match(new RegExp(`^alter table (?:if exists )?(?:only )?${ident} enable row level security`)))) {
    rls.add(m[1]);
  } else if ((m = sql.match(new RegExp(`^create (?:or replace )?function ${ident}\\s*\\(`)))) {
    if (!/^create (?:or replace )?function "?(?!public\.)[a-z_]+"?\./.test(sql)) {
      fns.set(m[1], { file, definer: /security definer/.test(sql), searchPath: /set search_path\b/.test(sql) });
    }
  } else if ((m = sql.match(new RegExp(`^create (?:or replace )?(?:materialized )?view ${ident}`)))) {
    views.set(m[1], file);
  } else if ((m = sql.match(new RegExp(`^drop (?:materialized )?view (?:if exists )?${ident}`)))) {
    views.delete(m[1]);
  } else if (/^revoke /.test(sql)) {
    const fnm = sql.match(new RegExp(`^revoke (?:all|execute)[a-z ]* on function ${ident}\\s*\\(.*? from (.*)$`));
    if (fnm && /\b(public|anon)\b/.test(fnm[2])) fnRevoked.add(fnm[1]);
    const allFn = sql.match(/^revoke (?:all|execute)[a-z ]* on all functions in schema public from (.*)$/);
    if (allFn && /\b(public|anon)\b/.test(allFn[1])) fnRevoked.add("*");
    const vm = sql.match(/^revoke [a-z, ]+ on (?:table )?(.+?) from (.*)$/);
    if (vm && /\banon\b/.test(vm[2])) for (const n of vm[1].split(",")) viewRevoked.add(n.trim().replace(/^"?public"?\./, "").replace(/"/g, ""));
  }
}

const allow = (() => {
  try {
    return JSON.parse(readFileSync(allowPath, "utf8"));
  } catch {
    return {};
  }
})();
const allowed = (rule, name) => Boolean(allow[rule]?.[name]);

const problems = [];
const flag = (rule, name, file, msg) => {
  if (!allowed(rule, name)) problems.push(`[${rule}] ${name} (${file}): ${msg}`);
};

for (const [t, file] of tables) if (!rls.has(t)) flag("rls", t, file, "table has no `enable row level security`");
for (const [f, d] of fns) {
  if (!d.definer) continue;
  if (!d.searchPath) flag("search-path", f, d.file, "SECURITY DEFINER function without `set search_path`");
  if (!fnRevoked.has(f) && !fnRevoked.has("*")) flag("fn-revoke", f, d.file, "SECURITY DEFINER function without `revoke execute ... from public|anon`");
}
for (const [v, file] of views) if (!viewRevoked.has(v)) flag("view-revoke", v, file, "view has no `revoke ... from anon` (default grants include INSERT/UPDATE/DELETE)");

const stale = [];
for (const rule of Object.keys(allow)) for (const name of Object.keys(allow[rule])) {
  const live = { rls: tables.has(name) && !rls.has(name), "search-path": fns.get(name)?.definer && !fns.get(name)?.searchPath,
    "fn-revoke": fns.get(name)?.definer && !fnRevoked.has(name), "view-revoke": views.has(name) && !viewRevoked.has(name) }[rule];
  if (!live) stale.push(`${rule}:${name}`);
}

console.log(`checked ${files.length} migrations: ${tables.size} tables, ${[...fns.values()].filter((d) => d.definer).length} SECURITY DEFINER functions, ${views.size} views`);
if (stale.length) console.log(`note: allow-list entries no longer needed: ${stale.join(", ")}`);
if (problems.length) {
  console.error(`\n${problems.length} migration security problem(s):\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("ok");
