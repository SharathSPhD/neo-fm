/** Pure helpers for the "dedicate this song" flow. Client-safe. */
import { z } from "zod";

export const DEDICATION_TO_MAX = 60;
export const DEDICATION_MESSAGE_MAX = 280;

// Strip control and bidi-override characters so a dedication can't
// reorder surrounding text or smuggle invisible content onto a card.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;

export function cleanDedicationText(s: string): string {
  return s.normalize("NFC").replace(UNSAFE, "").replace(/[ \t]+/g, " ").trim();
}

export const DedicationBodySchema = z
  .object({
    to: z.string().max(DEDICATION_TO_MAX * 2).nullable().optional(),
    message: z.string().max(DEDICATION_MESSAGE_MAX * 2).nullable().optional(),
  })
  .transform((b, ctx) => {
    const to = cleanDedicationText(b.to ?? "");
    const message = cleanDedicationText(b.message ?? "");
    if (Array.from(to).length > DEDICATION_TO_MAX) {
      ctx.addIssue({ code: "custom", message: "recipient_too_long", path: ["to"] });
    }
    if (Array.from(message).length > DEDICATION_MESSAGE_MAX) {
      ctx.addIssue({ code: "custom", message: "message_too_long", path: ["message"] });
    }
    if (message && !to) {
      ctx.addIssue({ code: "custom", message: "recipient_required", path: ["to"] });
    }
    return { to: to || null, message: message || null };
  });

/** wa.me deep link; opens WhatsApp (app or web) with the text prefilled. */
export function whatsappShareUrl(opts: {
  to: string | null;
  title: string;
  url: string;
}): string {
  const lead = opts.to
    ? `🎵 A song for ${opts.to}: “${opts.title}”`
    : `🎵 “${opts.title}”`;
  return `https://wa.me/?text=${encodeURIComponent(`${lead}\n${opts.url}`)}`;
}
