#!/usr/bin/env node
/**
 * Remove prod test accounts: e2e-bot*, showcase-a*, showcase-b* (any domain) and delivered@resend.dev.
 *
 * DRY RUN BY DEFAULT: lists matches and what hangs off them, deletes nothing.
 * To delete, pass BOTH --apply and --project-ref=<ref> matching the ref in NEXT_PUBLIC_SUPABASE_URL, so a stale env
 * can never delete from the wrong project. Deleting an auth user cascades to its public rows (jobs, songs, user_spend...).
 * Storage objects are NOT removed; clean the user's folder in the bucket separately if needed.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-test-users.mjs
 *   ... node scripts/cleanup-test-users.mjs --apply --project-ref=abcd1234
 */
import { createClient } from "@supabase/supabase-js";

export const TEST_EMAIL = /^(e2e-bot|showcase-a|showcase-b)[^@]*@|^delivered@resend\.dev$/i;

export function matchesTestUser(email) {
  return typeof email === "string" && TEST_EMAIL.test(email);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const refArg = args.find((a) => a.startsWith("--project-ref="))?.split("=")[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const ref = new URL(url).hostname.split(".")[0];
  if (apply && refArg !== ref) throw new Error(`--apply needs --project-ref=${ref} (the project in NEXT_PUBLIC_SUPABASE_URL)`);

  const db = createClient(url, key, { auth: { persistSession: false } });
  const matches = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    matches.push(...data.users.filter((u) => matchesTestUser(u.email)));
    if (data.users.length < 200) break;
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"} on project ${ref}: ${matches.length} test user(s) matched`);
  for (const u of matches) {
    const { count: jobs } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id);
    console.log(`  ${u.id}  ${u.email}  created ${u.created_at}  jobs=${jobs ?? "?"}`);
    if (apply) {
      const { error } = await db.auth.admin.deleteUser(u.id);
      console.log(error ? `    FAILED: ${error.message}` : "    deleted");
    }
  }
  if (!apply) console.log("Nothing deleted. Re-run with --apply --project-ref=<ref> to delete.");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
