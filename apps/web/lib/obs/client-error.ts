/**
 * Shape, validation and scrubbing for browser-reported errors. The browser
 * is untrusted: every field is length-capped and scrubbed server-side
 * regardless of what the client already did.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { UI_LANGS } from "../i18n/ui-strings";
import { scrubStack, scrubText, scrubUrl } from "./scrub";

export const ClientErrorSchema = z.object({
  name: z.string().max(100).optional(),
  message: z.string().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(2000).optional(),
  boundary: z.enum(["app", "marketing", "root", "global", "window", "promise"]).default("window"),
  lang: z.enum(UI_LANGS).optional(),
  digest: z.string().max(100).optional(),
  release: z.string().max(80).optional(),
});
export type ClientErrorInput = z.infer<typeof ClientErrorSchema>;

export interface ClientErrorRow {
  fingerprint: string;
  name: string;
  message: string;
  stack: string | null;
  route: string;
  boundary: string;
  lang: string | null;
  release: string | null;
  ua_family: string;
  request_id: string | null;
}

/** Coarse browser family only: the full UA string is a fingerprinting vector and not needed to debug. */
export function uaFamily(ua: string | null): string {
  if (!ua) return "unknown";
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return /Mobile/.test(ua) ? "chrome-mobile" : "chrome";
  if (/Safari\//.test(ua)) return /Mobile/.test(ua) ? "safari-mobile" : "safari";
  return "other";
}

/** Groups repeats of the same bug: error name + normalised message + first stack frame. */
export function fingerprintOf(name: string, message: string, stack: string): string {
  const firstFrame = stack.split("\n").find((l) => /^\s*at\s|@/.test(l)) ?? "";
  const norm = `${name}|${message.replace(/\d+/g, "N")}|${firstFrame.replace(/\d+/g, "N").trim()}`;
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function buildRow(input: ClientErrorInput, ctx: { userAgent: string | null; requestId?: string }): ClientErrorRow {
  const name = scrubText(input.name ?? "Error", 100) || "Error";
  const message = scrubText(input.message, 500);
  const stack = scrubStack(input.stack);
  return {
    fingerprint: fingerprintOf(name, message, stack),
    name,
    message,
    stack: stack || null,
    route: scrubUrl(input.url),
    boundary: input.boundary,
    lang: input.lang ?? null,
    release: input.release ? scrubText(input.release, 80) : null,
    ua_family: uaFamily(ctx.userAgent),
    request_id: ctx.requestId ?? null,
  };
}
