// supabase/functions/notify-job-complete -- transactional email on job complete
//
// Triggered by a Postgres trigger on public.jobs UPDATE
// (filter: new.status = 'completed' AND old.status <> 'completed').
//
// The function:
//   1. Validates the webhook payload shape.
//   2. Validates the x-webhook-secret header against NEO_FM_WEBHOOK_SECRET.
//   3. Uses the service-role key to look up the user's auth email and the
//      song's title (joined via PostgREST embedding).
//   4. Sends a transactional mail via Resend (RESEND_API_KEY) with the
//      song detail page link. Falls back to logging when no Resend key
//      is configured so we can dry-run before the keys are wired.
//   5. Returns 204 on success so the webhook is marked delivered.
//
// Webhook setup is performed by migration 0029_notify_job_complete_webhook.sql.
// Required secrets (set via Supabase dashboard or the management API):
//   RESEND_API_KEY               -- Resend account API key
//   RESEND_FROM                  -- verified sender, e.g. "neo-fm <noreply@...>"
//   NEO_FM_PUBLIC_APP_URL        -- e.g. https://neo-fm-web.vercel.app
//   NEO_FM_WEBHOOK_SECRET        -- shared secret between the trigger and this fn
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// deno-lint-ignore-file no-explicit-any

declare const Deno: { env: { get(name: string): string | undefined } };

type WebhookPayload = {
  type?: "UPDATE" | "INSERT" | "DELETE";
  table?: string;
  schema?: string;
  record?: {
    id?: string;
    user_id?: string;
    status?: string;
    finished_at?: string | null;
  };
  old_record?: {
    status?: string;
  } | null;
};

const PUBLIC_APP_URL =
  Deno.env.get("NEO_FM_PUBLIC_APP_URL") ?? "https://neo-fm-web.vercel.app";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM =
  Deno.env.get("RESEND_FROM") ?? "neo-fm <onboarding@resend.dev>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("NEO_FM_WEBHOOK_SECRET") ?? "";

async function fetchUserEmail(userId: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { email?: string | null };
  return body.email ?? null;
}

async function fetchSongTitle(songId: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  // Joins jobs -> song_documents via PostgREST embedding so the subject
  // line reads "Morning Rain in Saveri is ready" rather than a UUID.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(songId)}&select=song_documents(title)`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{
    song_documents?: { title?: string | null } | null;
  }>;
  return rows?.[0]?.song_documents?.title ?? null;
}

async function sendEmail(opts: {
  to: string;
  songId: string;
  title: string | null;
}): Promise<void> {
  const songUrl = `${PUBLIC_APP_URL}/songs/${opts.songId}`;
  const title = opts.title?.trim() || "Your neo-fm song";
  const subject = `${title} is ready`;
  const html = `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,sans-serif;
  background:#0a0612;color:#fef7ea;padding:32px;line-height:1.5;">
  <h1 style="font-weight:500;letter-spacing:-0.02em;">
    ${title} is ready
  </h1>
  <p>The DGX worker just finished generating your track.</p>
  <p>
    <a href="${songUrl}" style="display:inline-block;padding:12px 20px;
      background:#321656;color:#fef7ea;border-radius:6px;
      text-decoration:none;">
      Listen on neo-fm
    </a>
  </p>
  <p style="color:#8b8294;font-size:12px;margin-top:32px;">
    neo-fm &mdash; India-first AI music
  </p>
</body></html>`;
  const text =
    `${title} is ready.\n\n` +
    `Listen: ${songUrl}\n\n` +
    `--\nneo-fm`;
  if (!RESEND_API_KEY) {
    console.log("[notify-job-complete] no RESEND_API_KEY; would send", {
      to: opts.to,
      subject,
      songUrl,
    });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: opts.to,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

(globalThis as any).Deno?.serve?.(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (WEBHOOK_SECRET) {
    const got = req.headers.get("x-webhook-secret") ?? "";
    if (got !== WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
  }
  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (
    payload.type !== "UPDATE" ||
    payload.table !== "jobs" ||
    payload.schema !== "public" ||
    payload.record?.status !== "completed"
  ) {
    return new Response(null, { status: 204 });
  }
  // Suppress duplicate sends on re-deliveries.
  if (
    payload.old_record &&
    payload.old_record.status === "completed"
  ) {
    return new Response(null, { status: 204 });
  }
  const userId = payload.record.user_id;
  const songId = payload.record.id;
  if (!userId || !songId) {
    return new Response("missing fields", { status: 400 });
  }
  try {
    const email = await fetchUserEmail(userId);
    if (!email) {
      console.log("[notify-job-complete] no email for user", { userId });
      return new Response(null, { status: 204 });
    }
    const title = await fetchSongTitle(songId);
    await sendEmail({ to: email, songId, title });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[notify-job-complete] failed", err);
    return new Response("send failed", { status: 500 });
  }
});
