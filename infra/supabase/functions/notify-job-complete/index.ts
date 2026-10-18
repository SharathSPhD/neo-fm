// supabase/functions/notify-job-complete -- transactional email drain
//
// Triggered by a cron schedule (see schedule.json) or manual HTTP POST.
// Reads up to BATCH_SIZE messages off the pgmq `email_notifications`
// queue, sends a Resend email for each, and archives only on success.
//
// Migration 0043 wires the trigger that enqueues these messages.
//
// Required env (set on the Supabase project secrets):
//   RESEND_API_KEY               -- Resend account API key. While unset the
//                                   function is a no-op: messages stay queued
//                                   (and expire unsent after 24h).
//   RESEND_FROM                  -- verified sender, defaults to neo-fm <noreply@neo-fm.com>
//   APP_URL                      -- e.g. https://www.neo-fm.com -- used in the email link
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
  language?: string | null;
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
// Messages older than this are archived unsent, so adding the Resend key
// later does not blast users with stale "your song is ready" emails.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const APP_URL =
  Deno.env.get("APP_URL") ??
  Deno.env.get("NEO_FM_PUBLIC_APP_URL") ??
  "https://www.neo-fm.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM =
  Deno.env.get("RESEND_FROM") ?? "neo-fm <noreply@neo-fm.com>";
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
  language?: string | null;
}

export interface Copy {
  lang: string;
  fallbackTitle: string;
  subjectReady: (t: string) => string;
  subjectFailed: string;
  readyHeading: string;
  readyBody: (t: string) => string;
  listen: string;
  readyFooter: string;
  failedHeading: string;
  failedBody: (t: string) => string;
  retry: string;
  failedFooter: string;
  textReady: (t: string) => string;
  textFailed: (t: string) => string;
}

const EN: Copy = {
  lang: "en",
  fallbackTitle: "Your neo-fm song",
  subjectReady: (t) => `Your song "${t}" is ready 🎵`,
  subjectFailed: "Song generation failed",
  readyHeading: "Your song is ready to play",
  readyBody: (t) => `We just finished generating ${t}.`,
  listen: "Listen now",
  readyFooter:
    "neo-fm &mdash; India-first AI music. If you didn't request this song you can safely ignore this email.",
  failedHeading: "Sorry, your generation failed",
  failedBody: (t) =>
    `We hit a snag trying to render ${t}. No credit was charged.`,
  retry: "Try again",
  failedFooter:
    "neo-fm &mdash; If this keeps happening, reply to this email and we'll take a look.",
  textReady: (t) => `${t} is ready to play.`,
  textFailed: (t) => `Sorry, generation for "${t}" failed.`,
};

// Localised copy for the launch languages. Anything else falls back to EN.
const COPY: Record<string, Copy> = {
  en: EN,
  hi: {
    lang: "hi",
    fallbackTitle: "आपका neo-fm गीत",
    subjectReady: (t) => `आपका गीत "${t}" तैयार है 🎵`,
    subjectFailed: "गीत बनाना सफल नहीं हुआ",
    readyHeading: "आपका गीत सुनने के लिए तैयार है",
    readyBody: (t) => `हमने अभी ${t} बनाना पूरा किया है।`,
    listen: "अभी सुनें",
    readyFooter:
      "neo-fm &mdash; भारत के लिए AI संगीत। अगर आपने यह गीत नहीं बनवाया, तो इस ईमेल को अनदेखा करें।",
    failedHeading: "क्षमा करें, गीत नहीं बन पाया",
    failedBody: (t) =>
      `${t} बनाते समय कोई समस्या आ गई। आपका कोई क्रेडिट नहीं कटा।`,
    retry: "फिर से कोशिश करें",
    failedFooter:
      "neo-fm &mdash; अगर यह बार-बार हो, तो इस ईमेल का जवाब दें, हम देखेंगे।",
    textReady: (t) => `${t} सुनने के लिए तैयार है।`,
    textFailed: (t) => `क्षमा करें, "${t}" नहीं बन पाया।`,
  },
  ta: {
    lang: "ta",
    fallbackTitle: "உங்கள் neo-fm பாடல்",
    subjectReady: (t) => `உங்கள் பாடல் "${t}" தயார் 🎵`,
    subjectFailed: "பாடலை உருவாக்க முடியவில்லை",
    readyHeading: "உங்கள் பாடல் கேட்கத் தயார்",
    readyBody: (t) => `${t} பாடலை இப்போதுதான் உருவாக்கி முடித்தோம்.`,
    listen: "இப்போது கேளுங்கள்",
    readyFooter:
      "neo-fm &mdash; இந்தியாவுக்கான AI இசை. இந்தப் பாடலை நீங்கள் கேட்கவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கலாம்.",
    failedHeading: "மன்னிக்கவும், பாடல் உருவாகவில்லை",
    failedBody: (t) =>
      `${t} உருவாக்கும்போது சிக்கல் ஏற்பட்டது. உங்கள் கிரெடிட் கழிக்கப்படவில்லை.`,
    retry: "மீண்டும் முயலுங்கள்",
    failedFooter:
      "neo-fm &mdash; இது தொடர்ந்தால் இந்த மின்னஞ்சலுக்குப் பதிலளியுங்கள், நாங்கள் பார்க்கிறோம்.",
    textReady: (t) => `${t} கேட்கத் தயார்.`,
    textFailed: (t) => `மன்னிக்கவும், "${t}" உருவாகவில்லை.`,
  },
  te: {
    lang: "te",
    fallbackTitle: "మీ neo-fm పాట",
    subjectReady: (t) => `మీ పాట "${t}" సిద్ధంగా ఉంది 🎵`,
    subjectFailed: "పాటను రూపొందించడం విఫలమైంది",
    readyHeading: "మీ పాట వినడానికి సిద్ధంగా ఉంది",
    readyBody: (t) => `${t} పాటను ఇప్పుడే రూపొందించడం పూర్తి చేశాం.`,
    listen: "ఇప్పుడే వినండి",
    readyFooter:
      "neo-fm &mdash; భారతదేశానికి AI సంగీతం. మీరు ఈ పాటను అడగకపోతే ఈ ఇమెయిల్‌ను విస్మరించవచ్చు.",
    failedHeading: "క్షమించండి, పాట రూపొందలేదు",
    failedBody: (t) =>
      `${t} రూపొందిస్తుండగా సమస్య వచ్చింది. మీ క్రెడిట్ తగ్గలేదు.`,
    retry: "మళ్ళీ ప్రయత్నించండి",
    failedFooter:
      "neo-fm &mdash; ఇది మళ్ళీ మళ్ళీ జరిగితే ఈ ఇమెయిల్‌కు సమాధానం ఇవ్వండి, మేము చూస్తాం.",
    textReady: (t) => `${t} వినడానికి సిద్ధంగా ఉంది.`,
    textFailed: (t) => `క్షమించండి, "${t}" రూపొందలేదు.`,
  },
  kn: {
    lang: "kn",
    fallbackTitle: "ನಿಮ್ಮ neo-fm ಹಾಡು",
    subjectReady: (t) => `ನಿಮ್ಮ ಹಾಡು "${t}" ಸಿದ್ಧವಾಗಿದೆ 🎵`,
    subjectFailed: "ಹಾಡು ರಚಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ",
    readyHeading: "ನಿಮ್ಮ ಹಾಡು ಕೇಳಲು ಸಿದ್ಧವಾಗಿದೆ",
    readyBody: (t) => `${t} ಹಾಡನ್ನು ಈಗಷ್ಟೇ ರಚಿಸಿ ಮುಗಿಸಿದ್ದೇವೆ.`,
    listen: "ಈಗ ಕೇಳಿ",
    readyFooter:
      "neo-fm &mdash; ಭಾರತಕ್ಕಾಗಿ AI ಸಂಗೀತ. ನೀವು ಈ ಹಾಡನ್ನು ಕೇಳಿಲ್ಲದಿದ್ದರೆ ಈ ಇಮೇಲ್ ಅನ್ನು ನಿರ್ಲಕ್ಷಿಸಬಹುದು.",
    failedHeading: "ಕ್ಷಮಿಸಿ, ಹಾಡು ರಚನೆಯಾಗಲಿಲ್ಲ",
    failedBody: (t) =>
      `${t} ರಚಿಸುವಾಗ ಸಮಸ್ಯೆ ಎದುರಾಯಿತು. ನಿಮ್ಮ ಕ್ರೆಡಿಟ್ ಕಡಿತವಾಗಿಲ್ಲ.`,
    retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    failedFooter:
      "neo-fm &mdash; ಇದು ಪದೇ ಪದೇ ಆದರೆ ಈ ಇಮೇಲ್‌ಗೆ ಉತ್ತರಿಸಿ, ನಾವು ನೋಡುತ್ತೇವೆ.",
    textReady: (t) => `${t} ಕೇಳಲು ಸಿದ್ಧವಾಗಿದೆ.`,
    textFailed: (t) => `ಕ್ಷಮಿಸಿ, "${t}" ರಚನೆಯಾಗಲಿಲ್ಲ.`,
  },
  bn: {
    lang: "bn",
    fallbackTitle: "আপনার neo-fm গান",
    subjectReady: (t) => `আপনার গান "${t}" তৈরি 🎵`,
    subjectFailed: "গান তৈরি করা যায়নি",
    readyHeading: "আপনার গান শোনার জন্য তৈরি",
    readyBody: (t) => `আমরা এইমাত্র ${t} তৈরি করা শেষ করেছি।`,
    listen: "এখনই শুনুন",
    readyFooter:
      "neo-fm &mdash; ভারতের জন্য AI সংগীত। আপনি এই গান না চেয়ে থাকলে এই ইমেলটি উপেক্ষা করতে পারেন।",
    failedHeading: "দুঃখিত, গান তৈরি হয়নি",
    failedBody: (t) =>
      `${t} তৈরি করতে গিয়ে সমস্যা হয়েছে। আপনার ক্রেডিট কাটা হয়নি।`,
    retry: "আবার চেষ্টা করুন",
    failedFooter:
      "neo-fm &mdash; বারবার হলে এই ইমেলের উত্তর দিন, আমরা দেখব।",
    textReady: (t) => `${t} শোনার জন্য তৈরি।`,
    textFailed: (t) => `দুঃখিত, "${t}" তৈরি হয়নি।`,
  },
};

export function copyFor(language: string | null | undefined): Copy {
  return COPY[(language ?? "").toLowerCase()] ?? EN;
}

export function renderEmailSubject(opts: RenderOptions): string {
  const c = copyFor(opts.language);
  const title = (opts.songTitle ?? "").trim() || c.fallbackTitle;
  return opts.status === "completed" ? c.subjectReady(title) : c.subjectFailed;
}

export function renderEmailHtml(opts: RenderOptions): string {
  const c = copyFor(opts.language);
  const title = (opts.songTitle ?? "").trim() || c.fallbackTitle;
  // /songs/<job_id> is the canonical owner route.
  const songUrl = `${opts.appUrl}/songs/${opts.jobId}`;
  const retryUrl = `${opts.appUrl}/songs/new`;
  const bold = `<strong style="color:#fef7ea;">${escapeHtml(title)}</strong>`;
  if (opts.status === "completed") {
    return layout(c, {
      title: c.readyHeading,
      heading: c.readyHeading,
      body: c.readyBody(bold),
      cta: c.listen,
      href: songUrl,
      footer: c.readyFooter,
    });
  }
  return layout(c, {
    title: c.failedHeading,
    heading: c.failedHeading,
    body: c.failedBody(bold),
    cta: c.retry,
    href: retryUrl,
    footer: c.failedFooter,
  });
}

export function renderEmailText(opts: RenderOptions): string {
  const c = copyFor(opts.language);
  const title = (opts.songTitle ?? "").trim() || c.fallbackTitle;
  if (opts.status === "completed") {
    return (
      `${c.textReady(title)}\n\n` +
      `${c.listen}: ${opts.appUrl}/songs/${opts.jobId}\n\n` +
      `--\nneo-fm`
    );
  }
  return (
    `${c.textFailed(title)}\n\n` +
    `${c.retry}: ${opts.appUrl}/songs/new\n\n` +
    `--\nneo-fm`
  );
}

// One shared dark-theme layout; Indic system fonts are listed so clients
// that ship them render Devanagari/Tamil/Telugu/Kannada/Bengali cleanly.
function layout(
  c: Copy,
  o: {
    title: string;
    heading: string;
    body: string;
    cta: string;
    href: string;
    footer: string;
  },
): string {
  return `<!doctype html>
<html lang="${c.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0612;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0a0612;color:#fef7ea;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI','Noto Sans','Noto Sans Devanagari','Noto Sans Tamil','Noto Sans Telugu','Noto Sans Kannada','Noto Sans Bengali',sans-serif;line-height:1.6;">
          <tr>
            <td style="padding:0 0 24px 0;">
              <span style="font-size:18px;font-weight:600;letter-spacing:-0.02em;color:#fef7ea;">neo&middot;fm</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="margin:0;font-size:24px;font-weight:500;letter-spacing:-0.02em;color:#fef7ea;">
                ${escapeHtml(o.heading)}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px 0;">
              <p style="margin:0;font-size:16px;color:#d9d2c4;">
                ${o.body}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 32px 0;">
              <a href="${o.href}" style="display:inline-block;padding:14px 24px;background:#321656;color:#fef7ea;border-radius:8px;text-decoration:none;font-weight:500;font-size:15px;">
                ${escapeHtml(o.cta)}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0 0 0;border-top:1px solid #1f1631;">
              <p style="margin:0;font-size:12px;color:#8b8294;">
                ${o.footer}
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
    language: msg.language ?? null,
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

async function rpc(fn: string, body: Record<string, unknown>): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(body),
  });
}

// pgmq lives in a schema PostgREST does not expose, so the queue is reached through the service-role-only
// wrappers public.email_queue_read / email_queue_archive (migration 0087).
async function pgmqRead(): Promise<PgmqReadRow[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase service-role credentials missing");
  }
  const res = await rpc("email_queue_read", { p_qty: BATCH_SIZE, p_vt: VISIBILITY_TIMEOUT_SECS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`email_queue_read failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const rows = (await res.json()) as PgmqReadRow[];
  return Array.isArray(rows) ? rows : [];
}

async function pgmqArchive(msgId: number): Promise<void> {
  const res = await rpc("email_queue_archive", { p_msg_id: msgId });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`email_queue_archive(${msgId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

async function sendViaResend(body: ResendRequestBody): Promise<void> {
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
  now?: () => number;
}

export async function drainQueue(deps: DrainDeps): Promise<number> {
  const rows = await deps.read();
  const now = deps.now ? deps.now() : Date.now();
  let sent = 0;
  for (const row of rows) {
    const msg = row.message;
    const age = now - Date.parse(row.enqueued_at);
    if (Number.isFinite(age) && age > MAX_AGE_MS) {
      console.log("[notify-job-complete] stale message, archiving unsent", {
        msgId: row.msg_id,
        jobId: msg.job_id,
      });
      await deps.archive(row.msg_id);
      continue;
    }
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
  // No Resend key yet: leave every message queued (nothing is read, so
  // nothing is lost or retried) and report a clean no-op.
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ processed: 0, skipped: "no_resend_key" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
