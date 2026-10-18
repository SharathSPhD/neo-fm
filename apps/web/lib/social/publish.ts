import { open } from "./crypto";
import { socialFlags, type Platform, type SocialFlags } from "./config";
import { ADAPTERS } from "./platforms";
import { PlatformError, type Adapter, type Visibility } from "./platforms/types";

export interface QueueRow {
  id: string;
  platform: Platform;
  video_path: string;
  title: string;
  caption: string;
  visibility: Visibility;
  needs_native_read: boolean;
  native_read_ok: boolean;
  approved_at: string | null;
  attempts: number;
}

/** Narrow DB surface so the runner can be tested without Supabase. */
export interface PublishStore {
  due(platforms: Platform[], limit: number): Promise<QueueRow[] | "missing_table">;
  claim(id: string): Promise<boolean>;
  account(platform: Platform): Promise<{ secretSealed: string; extra: Record<string, string> } | null>;
  signedUrl(path: string): Promise<string>;
  finish(id: string, patch: { status: "published" | "failed" | "approved"; attempts?: number; error?: string | null; external_id?: string; external_url?: string | null }): Promise<void>;
}

export type Outcome = { id: string; platform: Platform; result: "published" | "failed" | "retry" | "held"; detail?: string };
export interface RunReport {
  ran: boolean;
  reason?: string;
  outcomes: Outcome[];
}

/** Why a row may not go out right now; null means it may. The same rules guard the approve endpoint. */
export function holdReason(row: Pick<QueueRow, "platform" | "approved_at" | "needs_native_read" | "native_read_ok" | "visibility">, flags: SocialFlags): string | null {
  if (!row.approved_at) return "not approved by S";
  if (row.needs_native_read && !row.native_read_ok) return "caption awaits native-speaker read";
  if ((row.platform === "instagram" || row.platform === "facebook") && !effectiveVisibility(row, flags).public) return "Meta has no private reels; needs public approval and SOCIAL_ALLOW_PUBLIC=1";
  return null;
}

export function effectiveVisibility(row: Pick<QueueRow, "visibility">, flags: SocialFlags): { visibility: Visibility; public: boolean } {
  const pub = row.visibility === "public" && flags.allowPublic;
  return { visibility: pub ? "public" : "private", public: pub };
}

export async function runPublish(
  store: PublishStore,
  env: NodeJS.ProcessEnv = process.env,
  f: typeof fetch = fetch,
  adapters: Record<Platform, Adapter> = ADAPTERS,
): Promise<RunReport> {
  const flags = socialFlags(env);
  if (!flags.enabled) return { ran: false, reason: "SOCIAL_PUBLISH_ENABLED is not 1", outcomes: [] };
  if (flags.platforms.length === 0) return { ran: false, reason: "SOCIAL_PLATFORMS is empty", outcomes: [] };
  const rows = await store.due(flags.platforms, flags.perRun * 4);
  if (rows === "missing_table") return { ran: false, reason: "social_posts table not migrated (0103)", outcomes: [] };

  const outcomes: Outcome[] = [];
  let sent = 0;
  for (const row of rows) {
    if (sent >= flags.perRun) break;
    const held = holdReason(row, flags);
    if (held) {
      outcomes.push({ id: row.id, platform: row.platform, result: "held", detail: held });
      continue;
    }
    const adapter = adapters[row.platform];
    const acct = await store.account(row.platform);
    const missing = adapter.missingEnv(env);
    if (!acct || missing.length) {
      outcomes.push({ id: row.id, platform: row.platform, result: "held", detail: !acct ? "account not connected" : `missing env ${missing.join(",")}` });
      continue;
    }
    if (!(await store.claim(row.id))) continue;
    sent++;
    try {
      const url = await store.signedUrl(row.video_path);
      const res = await adapter.publish(
        {
          title: row.title,
          caption: row.caption,
          visibility: effectiveVisibility(row, flags).visibility,
          videoUrl: url,
          loadBytes: async () => {
            const r = await f(url);
            if (!r.ok) throw new PlatformError(`video fetch: HTTP ${r.status}`);
            return new Uint8Array(await r.arrayBuffer());
          },
        },
        { secret: open(acct.secretSealed, env), extra: acct.extra },
        env,
        f,
      );
      await store.finish(row.id, { status: "published", external_id: res.externalId, external_url: res.url, error: null });
      outcomes.push({ id: row.id, platform: row.platform, result: "published" });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const permanent = e instanceof PlatformError && e.permanent;
      const attempts = row.attempts + 1;
      const dead = permanent || attempts >= 5;
      await store.finish(row.id, { status: dead ? "failed" : "approved", attempts, error: msg });
      outcomes.push({ id: row.id, platform: row.platform, result: dead ? "failed" : "retry", detail: msg });
    }
  }
  return { ran: true, outcomes };
}
