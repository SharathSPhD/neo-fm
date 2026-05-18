// supabase/functions/notify-job-complete/index.test.ts
//
// Deno-native tests for the email drain. We exercise the pure render
// helpers + the drain loop with mocked pgmq/Resend deps. No network.
//
// Run with: `deno test --allow-env --allow-net=none index.test.ts`

import {
  buildResendRequest,
  drainQueue,
  renderEmailHtml,
  renderEmailSubject,
  renderEmailText,
  type ResendRequestBody,
} from "./index.ts";

// Deno standard assertions. We pin to the std@0.224 line that matches
// the supabase edge runtime so this file runs unchanged in CI.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const APP_URL = "https://neo-fm.test";
const FROM = "neo-fm <no-reply@neo-fm.test>";

Deno.test("renderEmailSubject completed uses song title", () => {
  const subject = renderEmailSubject({
    jobId: "job-1",
    publicId: null,
    songTitle: "Morning Rain in Saveri",
    status: "completed",
    appUrl: APP_URL,
  });
  assertEquals(subject, 'Your song "Morning Rain in Saveri" is ready 🎵');
});

Deno.test("renderEmailSubject completed falls back to generic title", () => {
  const subject = renderEmailSubject({
    jobId: "job-1",
    publicId: null,
    songTitle: null,
    status: "completed",
    appUrl: APP_URL,
  });
  assertEquals(subject, 'Your song "Your neo-fm song" is ready 🎵');
});

Deno.test("renderEmailSubject failed is generic", () => {
  const subject = renderEmailSubject({
    jobId: "job-1",
    publicId: null,
    songTitle: "Anything",
    status: "failed",
    appUrl: APP_URL,
  });
  assertEquals(subject, "Song generation failed");
});

Deno.test("renderEmailHtml completed includes listen CTA + dark theme", () => {
  const html = renderEmailHtml({
    jobId: "job-abc",
    publicId: null,
    songTitle: "Test Song",
    status: "completed",
    appUrl: APP_URL,
  });
  assertStringIncludes(html, "background:#0a0612");
  assertStringIncludes(html, "Listen now");
  assertStringIncludes(html, `${APP_URL}/songs/job-abc`);
  assertStringIncludes(html, "Test Song");
  // Dark theme uses the cream text colour from the design tokens.
  assertStringIncludes(html, "#fef7ea");
});

Deno.test("renderEmailHtml failed shows try-again CTA", () => {
  const html = renderEmailHtml({
    jobId: "job-abc",
    publicId: null,
    songTitle: "Test Song",
    status: "failed",
    appUrl: APP_URL,
  });
  assertStringIncludes(html, "Try again");
  assertStringIncludes(html, `${APP_URL}/songs/new`);
  assertStringIncludes(html, "Sorry, your generation failed");
});

Deno.test("renderEmailHtml escapes user-controlled title", () => {
  const html = renderEmailHtml({
    jobId: "job-abc",
    publicId: null,
    songTitle: '<script>alert("xss")</script>',
    status: "completed",
    appUrl: APP_URL,
  });
  assert(
    !html.includes('<script>alert("xss")</script>'),
    "raw script tag must be escaped",
  );
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("renderEmailText completed contains listen URL", () => {
  const text = renderEmailText({
    jobId: "job-xyz",
    publicId: null,
    songTitle: "Hello",
    status: "completed",
    appUrl: APP_URL,
  });
  assertStringIncludes(text, "Hello is ready to play.");
  assertStringIncludes(text, `${APP_URL}/songs/job-xyz`);
});

Deno.test("buildResendRequest returns null when user_email is missing", () => {
  const body = buildResendRequest(
    {
      job_id: "job-1",
      user_email: null,
      song_title: "X",
      status: "completed",
      public_id: null,
    },
    { appUrl: APP_URL, from: FROM },
  );
  assertEquals(body, null);
});

Deno.test("buildResendRequest assembles a Resend payload", () => {
  const body = buildResendRequest(
    {
      job_id: "job-1",
      user_email: "user@example.com",
      song_title: "Aalapana",
      status: "completed",
      public_id: "ab12cd",
    },
    { appUrl: APP_URL, from: FROM },
  );
  assert(body !== null, "body must be non-null");
  assertEquals(body.from, FROM);
  assertEquals(body.to, "user@example.com");
  assertEquals(body.subject, 'Your song "Aalapana" is ready 🎵');
  assertStringIncludes(body.html, "Listen now");
  assertStringIncludes(body.text, `${APP_URL}/songs/job-1`);
});

Deno.test("drainQueue archives messages on successful send", async () => {
  const archived: number[] = [];
  const sentBodies: ResendRequestBody[] = [];

  const processed = await drainQueue({
    read: async () => [
      {
        msg_id: 101,
        read_ct: 1,
        enqueued_at: "2026-01-01T00:00:00Z",
        vt: "2026-01-01T00:00:30Z",
        message: {
          job_id: "job-101",
          user_email: "a@example.com",
          song_title: "Song A",
          status: "completed",
          public_id: null,
        },
      },
      {
        msg_id: 102,
        read_ct: 1,
        enqueued_at: "2026-01-01T00:00:00Z",
        vt: "2026-01-01T00:00:30Z",
        message: {
          job_id: "job-102",
          user_email: "b@example.com",
          song_title: null,
          status: "failed",
          public_id: null,
        },
      },
    ],
    archive: async (msgId) => {
      archived.push(msgId);
    },
    send: async (body) => {
      sentBodies.push(body);
    },
    appUrl: APP_URL,
    from: FROM,
  });

  assertEquals(processed, 2);
  assertEquals(archived.sort(), [101, 102]);
  assertEquals(sentBodies.length, 2);
  assertEquals(sentBodies[0].to, "a@example.com");
  assertEquals(sentBodies[1].subject, "Song generation failed");
});

Deno.test("drainQueue archives unsendable rows (no email) without sending", async () => {
  const archived: number[] = [];
  const sentBodies: ResendRequestBody[] = [];

  const processed = await drainQueue({
    read: async () => [
      {
        msg_id: 201,
        read_ct: 1,
        enqueued_at: "2026-01-01T00:00:00Z",
        vt: "2026-01-01T00:00:30Z",
        message: {
          job_id: "job-201",
          user_email: null,
          song_title: "Song A",
          status: "completed",
          public_id: null,
        },
      },
    ],
    archive: async (msgId) => {
      archived.push(msgId);
    },
    send: async (body) => {
      sentBodies.push(body);
    },
    appUrl: APP_URL,
    from: FROM,
  });

  assertEquals(processed, 0);
  assertEquals(archived, [201]);
  assertEquals(sentBodies.length, 0);
});

Deno.test("drainQueue leaves message in queue when send fails", async () => {
  const archived: number[] = [];

  const processed = await drainQueue({
    read: async () => [
      {
        msg_id: 301,
        read_ct: 1,
        enqueued_at: "2026-01-01T00:00:00Z",
        vt: "2026-01-01T00:00:30Z",
        message: {
          job_id: "job-301",
          user_email: "x@example.com",
          song_title: "X",
          status: "completed",
          public_id: null,
        },
      },
    ],
    archive: async (msgId) => {
      archived.push(msgId);
    },
    send: async () => {
      throw new Error("resend 429: rate limited");
    },
    appUrl: APP_URL,
    from: FROM,
  });

  assertEquals(processed, 0);
  assertEquals(
    archived,
    [],
    "failed sends must not archive -- visibility timeout takes over",
  );
});

Deno.test("buildResendRequest -- Resend API shape matches docs", () => {
  // This is the contract Resend documents at
  // https://resend.com/docs/api-reference/emails/send-email:
  //   POST /emails with { from, to, subject, html, (text) }
  const body = buildResendRequest(
    {
      job_id: "job-1",
      user_email: "user@example.com",
      song_title: "S",
      status: "completed",
      public_id: null,
    },
    { appUrl: APP_URL, from: FROM },
  );
  assert(body !== null);
  const keys = Object.keys(body).sort();
  assertEquals(keys, ["from", "html", "subject", "text", "to"]);
});
