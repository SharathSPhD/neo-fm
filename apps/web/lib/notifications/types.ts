/**
 * Notification types, user preferences and display copy. Pure and client-safe:
 * the bell, the preferences page, the push payload builder and the tests all
 * use the same definitions. Mirrors the producers in migration 0085.
 */
import { z } from "zod";

export const NOTIFICATION_TYPES = [
  "song_ready",
  "song_failed",
  "like",
  "follow",
  "collection_add",
  "dedication",
  "takedown",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Types that carry failure or safety information: in-app delivery can't be switched off. */
export const MANDATORY_TYPES: readonly NotificationType[] = ["takedown", "song_failed"];

/** Defaults when a user has not chosen: everything in-app; push only for the personal, low-volume types. */
export const DEFAULT_PUSH: Record<NotificationType, boolean> = {
  song_ready: true,
  song_failed: true,
  like: false,
  follow: false,
  collection_add: false,
  dedication: false,
  takedown: true,
};

export interface TypePref {
  in_app: boolean;
  push: boolean;
}
export type ResolvedPrefs = Record<NotificationType, TypePref>;

export function resolvePrefs(raw: unknown): ResolvedPrefs {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as ResolvedPrefs;
  for (const t of NOTIFICATION_TYPES) {
    const p = src[t] && typeof src[t] === "object" ? (src[t] as Record<string, unknown>) : {};
    out[t] = {
      in_app: MANDATORY_TYPES.includes(t) ? true : typeof p.in_app === "boolean" ? p.in_app : true,
      push: typeof p.push === "boolean" ? p.push : DEFAULT_PUSH[t],
    };
  }
  return out;
}

const TypePrefPatch = z.object({ in_app: z.boolean().optional(), push: z.boolean().optional() }).strict();

/** Partial update: only known types, only the two switches. */
export const PrefsPatchSchema = z
  .record(z.enum(NOTIFICATION_TYPES), TypePrefPatch)
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type PrefsPatch = z.infer<typeof PrefsPatchSchema>;

/** Applies a patch to stored prefs, returning the sparse object to store. Mandatory types stay in-app. */
export function applyPrefsPatch(stored: unknown, patch: PrefsPatch): Record<string, TypePref> {
  const merged = resolvePrefs(stored);
  for (const [t, p] of Object.entries(patch) as [NotificationType, Partial<TypePref>][]) {
    if (p.in_app !== undefined && !MANDATORY_TYPES.includes(t)) merged[t].in_app = p.in_app;
    if (p.push !== undefined) merged[t].push = p.push;
  }
  return merged;
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  count: number;
  created_at: string;
  read_at: string | null;
}

export interface Rendered {
  title: string;
  body?: string;
  href: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const quote = (t: string | null) => (t ? `“${t.length > 60 ? `${t.slice(0, 59)}…` : t}”` : "your song");

/**
 * Copy and link for a notification. Everything shown comes from `data`
 * written by our own producers; nothing is interpolated as HTML. Links are
 * always same-origin paths.
 */
export function renderNotification(n: Pick<NotificationRow, "type" | "data" | "count">): Rendered {
  const d = n.data ?? {};
  const title = str(d.title);
  const job = str(d.job_id);
  const song = job ? `/songs/${job}` : "/library";
  switch (n.type) {
    case "song_ready":
      return { title: `${quote(title)} is ready`, href: song };
    case "song_failed":
      return { title: `${quote(title)} couldn't be finished`, body: "Open it to retry; failed songs don't count toward your plan.", href: song };
    case "like":
      return {
        title: n.count > 1 ? `${n.count} new likes on ${quote(title)}` : `New like on ${quote(title)}`,
        href: song,
      };
    case "follow": {
      const handle = str(d.handle);
      const safe = handle && /^[A-Za-z0-9_.-]{1,40}$/.test(handle) ? handle : null;
      return {
        title:
          n.count > 1
            ? `${n.count} new followers`
            : safe
              ? `@${safe} started following you`
              : "You have a new follower",
        href: safe && n.count === 1 ? `/u/${safe}` : "/account",
      };
    }
    case "collection_add":
      return {
        title: n.count > 1 ? `${quote(title)} was added to ${n.count} playlists` : `${quote(title)} was added to a playlist`,
        href: song,
      };
    case "dedication":
      return { title: `A song was dedicated to you`, body: title ? quote(title) : undefined, href: str(d.public_id) ? `/s/${str(d.public_id)}` : "/library" };
    case "takedown":
      return {
        title: `${quote(title)} was removed from public view`,
        body: "It's still in your library. Reply to grievance@neo-fm.com if you think this was a mistake.",
        href: song,
      };
  }
}
