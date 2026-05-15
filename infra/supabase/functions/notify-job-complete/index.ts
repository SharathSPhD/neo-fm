// supabase/functions/notify-job-complete (Sprint 4)
//
// Triggered by a Supabase Database Webhook on `public.jobs` UPDATE
// (filter: new.status = 'completed' AND old.status <> 'completed').
//
// The function:
//   1. Validates the webhook payload shape.
//   2. Uses the service-role key to look up the user's auth email.
//   3. Sends a transactional mail via Resend (RESEND_API_KEY) with the
//      song detail page link. Falls back to logging when no Resend
//      key is configured so local supabase functions serve can still
//      exercise the path.
//   4. Returns 204 on success so the webhook is marked delivered.
//
// Webhook setup (one-time, performed manually in the Supabase studio):
//   Source  : public.jobs UPDATE
//   Method  : POST
//   URL     : https://<project>.functions.supabase.co/notify-job-complete
//   Headers : x-webhook-secret: <NEO_FM_WEBHOOK_SECRET>
//
// Verified to compile on the Deno 1.45+ Supabase Edge runtime.
//
// deno-lint-ignore-file no-explicit-any
/// <reference path="https://esm.sh/v135/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

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
  Deno.env.get("NEO_FM_PUBLIC_APP_URL") ?? "https://neo-fm.app";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM =
  Deno.env.get("RESEND_FROM") ?? "neo-fm <noreply@neo-fm.app>";
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

async function sendEmail(opts: {
  to: string;
  songId: string;
}): Promise<void> {
  const songUrl = `${PUBLIC_APP_URL}/songs/${opts.songId}`;
  const subject = "Your neo-fm song is ready";
  const html = `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,sans-serif;
  background:#0a0612;color:#fef7ea;padding:32px;line-height:1.5;">
  <h1 style="font-weight:500;letter-spacing:-0.02em;">
    Your song is ready
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
    `Your neo-fm song is ready.\n\n` +
    `Listen: ${songUrl}\n\n` +
    `--\nneo-fm`;
  if (!RESEND_API_KEY) {
    console.log("[notify-job-complete] no RESEND_API_KEY; would send", {
      to: opts.to,
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
    // Not relevant; mark as delivered.
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
    await sendEmail({ to: email, songId });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[notify-job-complete] failed", err);
    return new Response("send failed", { status: 500 });
  }
});
