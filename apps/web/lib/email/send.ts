/**
 * Transactional email entry point shared by billing (dunning) and song-ready notifications.
 * Without RESEND_API_KEY it is a no-op that reports `{ sent: false }`, so callers can invoke it unconditionally in
 * dev, preview and prod-before-launch.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendEmailResult = { sent: true; id: string | null } | { sent: false; reason: "not_configured" | "failed" };

const DEFAULT_FROM = "neo-fm <noreply@neo-fm.com>";
const from = () => process.env.EMAIL_FROM ?? DEFAULT_FROM;

export async function sendEmail(msg: EmailMessage): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: from(), to: msg.to, subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) {
      console.warn(`[email] Resend rejected message (HTTP ${res.status})`);
      return { sent: false, reason: "failed" };
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: body?.id ?? null };
  } catch (err) {
    console.warn(`[email] send failed: ${err instanceof Error ? err.message : String(err)}`);
    return { sent: false, reason: "failed" };
  }
}
