// node --test scripts/tests/check-migrations-security.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "check-migrations-security.mjs");

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  const r = spawnSync("node", [script, dir, join(dir, "no-allow.json")], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

const GOOD = {
  "0001.sql": `create table public.a (id int);
alter table public.a enable row level security;
create function public.f() returns int language sql security definer set search_path = '' as $$ select 1; $$;
revoke execute on function public.f() from public, anon;
create view public.v as select id from public.a;
revoke all on public.v from anon, authenticated;`,
};

test("clean migrations pass", () => assert.equal(run(GOOD).code, 0));

test("table without RLS fails", () => {
  const r = run({ "0001.sql": "create table public.leaky (id int);" });
  assert.equal(r.code, 1);
  assert.match(r.out, /\[rls\] leaky/);
});

test("RLS enabled in a later migration is accepted", () => {
  const r = run({ "0001.sql": "create table public.t (id int);", "0002.sql": "alter table public.t enable row level security;" });
  assert.equal(r.code, 0);
});

test("SECURITY DEFINER without search_path fails, and the latest definition wins", () => {
  const bad = run({ "0001.sql": `create function public.f() returns int language sql security definer as $$ select 1; $$; revoke execute on function public.f() from public;` });
  assert.match(bad.out, /\[search-path\] f/);
  const fixed = run({
    "0001.sql": `create function public.f() returns int language sql security definer as $$ select 1; $$; revoke execute on function public.f() from public;`,
    "0002.sql": `create or replace function public.f() returns int language sql security definer set search_path = '' as $$ select 1; $$;`,
  });
  assert.equal(fixed.code, 0);
});

test("SECURITY DEFINER without a revoke fails", () => {
  const r = run({ "0001.sql": `create function public.g() returns int language sql security definer set search_path = '' as $$ select 1; $$;` });
  assert.match(r.out, /\[fn-revoke\] g/);
});

test("INVOKER functions need neither search_path nor revoke", () => {
  assert.equal(run({ "0001.sql": `create function public.h() returns int language sql as $$ select 1; $$;` }).code, 0);
});

test("view without revoke from anon fails; a multi-view revoke counts", () => {
  assert.match(run({ "0001.sql": "create view public.v as select 1;" }).out, /\[view-revoke\] v/);
  assert.equal(run({ "0001.sql": "create view public.v1 as select 1; create view public.v2 as select 1; revoke all on public.v1, public.v2 from anon, authenticated;" }).code, 0);
});

test("semicolons and keywords inside comments and function bodies do not confuse the parser", () => {
  const r = run({ "0001.sql": `-- create table public.commented (id int);
create function public.k() returns int language plpgsql security definer set search_path = '' as $$ begin perform 1; return 1; end; $$;
revoke execute on function public.k() from public;` });
  assert.equal(r.code, 0, r.out);
});
