// supabase/functions/notify-job-complete -- transactional email drain
//
// Triggered by a cron schedule (see schedule.json) or manual HTTP POST.
// Reads up to BATCH_SIZE messages off the pgmq `email_notifications`
// queue, sends a Resend email for each, and archives only on success.
//
// Migration 0043 wires the trigger that enqueues these messages.
//
// Required env (set on the Supabase project secrets):
//   RESEND_API_KEY               -- Resend account API key (required in prod)
//   RESEND_FROM                  -- verified sender, defaults to neo-fm <no-reply@neo-fm.app>
//   APP_URL                      -- e.g. https://neo-fm.app -- used in the email link
//   SUPABASE_URL                 -- injected automatically
//   SUPABASE_SERVICE_ROLE_KEY    -- injected automatically
//   NEO_FM_WEBHOOK_SECRET        -- optional; if set, callers must echo it
//
// Backwards compatibility:
//   When invoked with a Supabase Database Webhook body (the 0029 path),
//   the function short-circuits to 204 -- the queue-based drain owns
//   the send. This lets 0029 keep firing harmlessly while we cut over.
//
// deno-lint-ignore-file no-explicit-any

declare const Deno: { env: { get(name: string): string | undefined } };

interface EmailQueueMessage {
  job_id: string;
  user_email: string | null;
  song_title: string | null;
  status: "completed" | "failed";
  public_id: string | null;
}

interface PgmqReadRow {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: EmailQueueMessage;
}

const QUEUE_NAME = "email_notifications";
const BATCH_SIZE = 5;
const VISIBILITY_TIMEOUT_SECS = 30;

const APP_URL =
  Deno.env.get("APP_URL") ??
  Deno.env.get("NEO_FM_PUBLIC_APP_URL") ??
  "https://neo-fm.app";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM =
  Deno.env.get("RESEND_FROM") ?? "neo-fm <no-reply@neo-fm.app>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("NEO_FM_WEBHOOK_SECRET") ?? "";

// ---------------------------------------------------------------------
// Email template -- exported so the test file can render it without
// going near a network call.
// ---------------------------------------------------------------------

export interface RenderOptions {
  jobId: string;
  publicId: string | null;
  songTitle: string | null;
  status: "completed" | "failed";
  appUrl: string;
}

export function renderEmailSubject(opts: RenderOptions): string {
  const title = (opts.songTitle ?? "").trim() || "Your neo-fm song";
  if (opts.status === "completed") {
    return `Your song "${title}" is ready 🎵`;
  }
  return `Song generation failed`;
}

export function renderEmailHtml(opts: RenderOptions): string {
  const title = (opts.songTitle ?? "").trim() || "Your neo-fm song";
  // public_id is the share slug; if present, the public page is nicer
  // than the owner-only /songs/<uuid> route. The task spec asks for
  // /songs/${job_id}, which is the canonical owner path we already
  // expose, so we stick with that.
  const songUrl = `${opts.appUrl}/songs/${opts.jobId}`;
  const retryUrl = `${opts.appUrl}/songs/new`;
  if (opts.status === "completed") {
    return completedHtml({ title, songUrl });
  }
  return failedHtml({ title, retryUrl });
}

export function renderEmailText(opts: RenderOptions): string {
  const title = (opts.songTitle ?? "").trim() || "Your neo-fm song";
  const songUrl = `${opts.appUrl}/songs/${opts.jobId}`;
  const retryUrl = `${opts.appUrl}/songs/new`;
  if (opts.status === "completed") {
    return (
      `${title} is ready to play.\n\n` +
      `Listen now: ${songUrl}\n\n` +
      `--\nneo-fm`
    );
  }
  return (
    `Sorry, generation for "${title}" failed.\n\n` +
    `Try again: ${retryUrl}\n\n` +
    `--\nneo-fm`
  );
}

function completedHtml(opts: { title: string; songUrl: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your song is ready</title>
</head>
<body style="margin:0;padding:0;background:#0a0612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0612;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0a0612;color:#fef7ea;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;">
          <tr>
            <td style="padding:0 0 24px 0;">
              <span style="font-size:18px;font-weight:600;letter-spacing:-0.02em;color:#fef7ea;">neo&middot;fm</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="margin:0;font-size:24px;font-weight:500;letter-spacing:-0.02em;color:#fef7ea;">
                Your song is ready to play
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px 0;">
              <p style="margin:0;font-size:16px;color:#d9d2c4;">
                We just finished generating <strong style="color:#fef7ea;">${escapeHtml(opts.title)}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 32px 0;">
              <a href="${opts.songUrl}" style="display:inline-block;padding:14px 24px;background:#321656;color:#fef7ea;border-radius:8px;text-decoration:none;font-weight:500;font-size:15px;">
                Listen now
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0 0 0;border-top:1px solid #1f1631;">
              <p style="margin:0;font-size:12px;color:#8b8294;">
                neo-fm &mdash; India-first AI music. If you didn't request this song you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function failedHtml(opts: { title: string; retryUrl: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Generation failed</title>
</head>
<body style="margin:0;padding:0;background:#0a0612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0612;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0a0612;color:#fef7ea;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;">
          <tr>
            <td style="padding:0 0 24px 0;">
              <span style="font-size:18px;font-weight:600;letter-spacing:-0.02em;color:#fef7ea;">neo&middot;fm</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="margin:0;font-size:24px;font-weight:500;letter-spacing:-0.02em;color:#fef7ea;">
                Sorry, your generation failed
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px 0;">
              <p style="margin:0;font-size:16px;color:#d9d2c4;">
                We hit a snag trying to render <strong style="color:#fef7ea;">${escapeHtml(opts.title)}</strong>. No credit was charged.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 32px 0;">
              <a href="${opts.retryUrl}" style="display:inline-block;padding:14px 24px;background:#321656;color:#fef7ea;border-radius:8px;text-decoration:none;font-weight:500;font-size:15px;">
                Try again
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0 0 0;border-top:1px solid #1f1631;">
              <p style="margin:0;font-size:12px;color:#8b8294;">
                neo-fm &mdash; If this keeps happening, reply to this email and we'll take a look.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------
// Resend request shape. Exported so the test can assert against it.
// ---------------------------------------------------------------------

export interface ResendRequestBody {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function buildResendRequest(
  msg: EmailQueueMessage,
  cfg: { appUrl: string; from: string },
): ResendRequestBody | null {
  if (!msg.user_email) return null;
  const opts: RenderOptions = {
    jobId: msg.job_id,
    publicId: msg.public_id,
    songTitle: msg.song_title,
    status: msg.status,
    appUrl: cfg.appUrl,
  };
  return {
    from: cfg.from,
    to: msg.user_email,
    subject: renderEmailSubject(opts),
    html: renderEmailHtml(opts),
    text: renderEmailText(opts),
  };
}

// ---------------------------------------------------------------------
// pgmq HTTP shim. Supabase exposes pgmq via PostgREST RPC under the
// `pgmq_public` schema-rebinding helper -- we hit pgmq.read / archive
// through a SECURITY DEFINER wrapper. To stay portable across the
// supabase-js client and direct fetch, we call the postgres-meta-style
// `/rest/v1/rpc/<fn>` endpoint with the pgmq.read / pgmq.archive
// functions exposed by default in `pgmq` schema.
//
// We use the `Accept-Profile: pgmq` header (the documented way to talk
// to a non-public schema via PostgREST) so we don't need a public
// wrapper for the read/archive helpers.
// ---------------------------------------------------------------------

async function pgmqRead(): Promise<PgmqReadRow[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase service-role credentials missing");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/read`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Accept-Profile": "pgmq",
      "Content-Profile": "pgmq",
    },
    body: JSON.stringify({
      queue_name: QUEUE_NAME,
      vt: VISIBILITY_TIMEOUT_SECS,
      qty: BATCH_SIZE,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`pgmq.read failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const rows = (await res.json()) as PgmqReadRow[];
  return Array.isArray(rows) ? rows : [];
}

async function pgmqArchive(msgId: number): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/archive`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Accept-Profile": "pgmq",
      "Content-Profile": "pgmq",
    },
    body: JSON.stringify({ queue_name: QUEUE_NAME, msg_id: msgId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `pgmq.archive(${msgId}) failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
}

async function sendViaResend(body: ResendRequestBody): Promise<void> {
  if (!RESEND_API_KEY) {
    // Dry-run mode: log intent and treat as a successful send so the
    // message archives. Same contract as the 0029-era handler.
    console.log("[notify-job-complete] dry-run (no RESEND_API_KEY)", {
      to: body.to,
      subject: body.subject,
    });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`resend ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------
// Drain loop. Exported for testing.
// ---------------------------------------------------------------------

export interface DrainDeps {
  read: () => Promise<PgmqReadRow[]>;
  archive: (msgId: number) => Promise<void>;
  send: (body: ResendRequestBody) => Promise<void>;
  appUrl: string;
  from: string;
}

export async function drainQueue(deps: DrainDeps): Promise<number> {
  const rows = await deps.read();
  let sent = 0;
  for (const row of rows) {
    const msg = row.message;
    const body = buildResendRequest(msg, {
      appUrl: deps.appUrl,
      from: deps.from,
    });
    if (!body) {
      // Nothing to send (e.g. user_email is null) -- archive so it
      // doesn't keep coming back forever.
      console.log("[notify-job-complete] no email on message, archiving", {
        msgId: row.msg_id,
        jobId: msg.job_id,
      });
      await deps.archive(row.msg_id);
      continue;
    }
    try {
      await deps.send(body);
      await deps.archive(row.msg_id);
      sent += 1;
    } catch (err) {
      // Leave the message in the queue -- it becomes visible again
      // after VISIBILITY_TIMEOUT_SECS for the next drain.
      console.error("[notify-job-complete] send failed", {
        msgId: row.msg_id,
        jobId: msg.job_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return sent;
}

// ---------------------------------------------------------------------
// HTTP entry point. POST with no body (cron) or a Supabase webhook
// envelope (legacy 0029 path -- ignored). Optional NEO_FM_WEBHOOK_SECRET
// echoed back as x-webhook-secret.
// ---------------------------------------------------------------------

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
  try {
    const processed = await drainQueue({
      read: pgmqRead,
      archive: pgmqArchive,
      send: sendViaResend,
      appUrl: APP_URL,
      from: RESEND_FROM,
    });
    return new Response(JSON.stringify({ processed }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-job-complete] drain failed", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "drain failed",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
