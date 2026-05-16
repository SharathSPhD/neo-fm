// supabase/functions/orphan-reconciler (Sprint C bug-b)
//
// Cron-triggered reconciliation pass that finds jobs which are
// `status='completed'` but have no rendered `tracks` row, then either:
//   - re-enqueues them via the SECURITY DEFINER `recover_song_job` RPC
//     (calling it under a service-role JWT so auth.uid() returns the
//     job owner -- actually we can't get auth.uid() from the cron, so
//     we hit a service-role bypass path), or
//   - if the job has been attempted `maxAttempts` times already, flips
//     it to `failed` with an explicit error so the UI stops looping
//     the user through endless recover clicks.
//
// Invocation:
//   - Recommended: Supabase Scheduled Function via pg_cron, every 5 min.
//     See README.md for the SQL snippet.
//
// Configuration:
//   ORPHAN_RECONCILER_MAX_ATTEMPTS  default 3
//   ORPHAN_RECONCILER_GRACE_SECONDS default 600 (don't touch fresh ones)
//   SUPABASE_URL                     auto
//   SUPABASE_SERVICE_ROLE_KEY        secret
//   NEO_FM_RECONCILER_SECRET         optional bearer used by the cron POST
//
// Authorization:
//   The function rejects requests without the expected bearer header
//   when NEO_FM_RECONCILER_SECRET is set. pg_cron's `net.http_post`
//   call attaches a header `Authorization: Bearer ${secret}`.
//
// Verified to compile on Deno 1.45+ Supabase Edge runtime.
//
// deno-lint-ignore-file no-explicit-any
/// <reference path="https://esm.sh/v135/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

declare const Deno: { env: { get(name: string): string | undefined } };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RECONCILER_SECRET =
  Deno.env.get("NEO_FM_RECONCILER_SECRET") ?? "";

const MAX_ATTEMPTS = Number(
  Deno.env.get("ORPHAN_RECONCILER_MAX_ATTEMPTS") ?? "3",
);
const GRACE_SECONDS = Number(
  Deno.env.get("ORPHAN_RECONCILER_GRACE_SECONDS") ?? "600",
);

type OrphanRow = {
  job_id: string;
  user_id: string;
  song_document_id: string;
  attempts: number;
  finished_at: string | null;
  recovered_at: string | null;
};

function isAuthorized(req: Request): boolean {
  if (!RECONCILER_SECRET) return true; // no secret configured -> open
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${RECONCILER_SECRET}`;
}

async function fetchOrphans(): Promise<OrphanRow[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  // GRACE_SECONDS keeps us off freshly-completed rows so we don't race
  // a slow tracks INSERT.
  const url = new URL(`${SUPABASE_URL}/rest/v1/orphan_jobs`);
  url.searchParams.set(
    "select",
    "job_id,user_id,song_document_id,attempts,finished_at,recovered_at",
  );
  // PostgREST: finished_at < now() - grace * 1 second
  const cutoff = new Date(Date.now() - GRACE_SECONDS * 1000).toISOString();
  url.searchParams.set("finished_at", `lt.${cutoff}`);
  url.searchParams.set("limit", "100");
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    console.error("[orphan-reconciler] fetch failed", res.status);
    return [];
  }
  return (await res.json()) as OrphanRow[];
}

async function markFailed(jobId: string, reason: string): Promise<boolean> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/jobs`);
  url.searchParams.set("id", `eq.${jobId}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: reason,
    }),
  });
  return res.ok;
}

async function reenqueue(orphan: OrphanRow): Promise<boolean> {
  // SECURITY DEFINER RPC `public.reconciler_recover_job` resets the
  // row and enqueues atomically inside one transaction; EXECUTE grant
  // is service_role-only so we can't call it from anywhere else.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/reconciler_recover_job`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_job_id: orphan.job_id }),
    },
  );
  if (!res.ok) {
    console.error(
      "[orphan-reconciler] reconciler_recover_job failed",
      res.status,
      await res.text(),
    );
    return false;
  }
  return true;
}

Deno.serve(async (req: Request) => {
  if (!isAuthorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("not configured", { status: 503 });
  }

  const orphans = await fetchOrphans();
  let recovered = 0;
  let failedOut = 0;
  for (const o of orphans) {
    if (o.attempts >= MAX_ATTEMPTS) {
      if (await markFailed(o.job_id, "orphan_max_attempts_exhausted")) {
        failedOut++;
      }
      continue;
    }
    if (await reenqueue(o)) {
      recovered++;
    }
  }

  return new Response(
    JSON.stringify({
      scanned: orphans.length,
      recovered,
      failed_out: failedOut,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
