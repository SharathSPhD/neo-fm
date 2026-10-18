/**
 * Transactional emails for the abuse-report flow (takedown notice to the owner, outcome to reporters).
 * Sent straight through Resend from the admin route: these are rare, operator-triggered, and the pgmq drain
 * (notify-job-complete) only understands job-complete payloads. Without RESEND_API_KEY it logs and reports `sent:false`.
 */

export interface Mail { to: string; subject: string; text: string }
export type Mailer = (mail: Mail) => Promise<{ sent: boolean }>;

const GRIEVANCE = "info@technektar.com";

export function takedownNotice(args: { title: string | null; category: string | null; note: string }): Omit<Mail, "to"> {
  const title = (args.title ?? "").trim() || "your song";
  return {
    subject: `We removed "${title}" from public view`,
    text:
      `After a report and review, "${title}" is no longer public on neo-fm` +
      `${args.category ? ` (reason: ${args.category.replace(/_/g, " ")})` : ""}.\n\n` +
      `${args.note ? `Note from the reviewer: ${args.note}\n\n` : ""}` +
      `The song is still in your library and you can keep it. If you think this was a mistake, reply to ${GRIEVANCE} and we will look again.\n\n--\nneo-fm`,
  };
}

export function reporterOutcome(args: { action: "takedown" | "dismiss" }): Omit<Mail, "to"> {
  return {
    subject: "Update on your neo-fm report",
    text:
      args.action === "takedown"
        ? "Thanks for your report. We reviewed it and removed the song from public view.\n\n--\nneo-fm"
        : `Thanks for your report. We reviewed it and did not find a reason to remove the song. If you disagree, write to ${GRIEVANCE}.\n\n--\nneo-fm`,
  };
}

export function resendMailer(env = process.env, f: typeof fetch = fetch): Mailer {
  return async (mail) => {
    const key = env.RESEND_API_KEY;
    if (!key) {
      console.log("[moderation-email] dry-run (no RESEND_API_KEY)", { to: mail.to, subject: mail.subject });
      return { sent: false };
    }
    const res = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.RESEND_FROM ?? "neo-fm <no-reply@neo-fm.app>", to: mail.to, subject: mail.subject, text: mail.text }),
    });
    return { sent: res.ok };
  };
}
