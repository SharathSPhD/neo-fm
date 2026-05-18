// apps/web/lib/email/types.ts -- shared shape for email_notifications queue
//
// This is the payload written by public.enqueue_job_complete_email
// (migration 0043) and consumed by the notify-job-complete Edge
// Function. Mirroring the type on the Next.js side lets admin/debug
// routes inspect the queue with the same shape the Edge Function sees.

export interface EmailQueueMessage {
  job_id: string;
  user_email: string | null;
  song_title: string | null;
  status: "completed" | "failed";
  public_id: string | null;
}
