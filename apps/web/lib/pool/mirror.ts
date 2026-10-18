import type { SupabaseClient } from "@supabase/supabase-js";

import { r2Configured, r2Key, r2Request, type R2Env } from "./r2";

/**
 * Best-effort copy of one admitted pool track from Supabase Storage into R2, so a newly admitted track is already on the
 * CDN when POOL_CDN_BASE serves it. A no-op without R2 env; never throws, so admission is unaffected. Objects already in R2 are skipped.
 */
export async function mirrorAdmittedTrack(db: SupabaseClient, audioPath: string, env: R2Env = process.env): Promise<"copied" | "present" | "skipped" | "failed"> {
  if (!r2Configured(env)) return "skipped";
  try {
    const key = r2Key(audioPath);
    if (!key || key.includes("..")) return "skipped";
    if ((await r2Request("HEAD", key, undefined, env)).status === 200) return "present";
    const src = await db.storage.from("tracks").download(key);
    if (!src.data) return "failed";
    return (await r2Request("PUT", key, Buffer.from(await src.data.arrayBuffer()), env)).ok ? "copied" : "failed";
  } catch {
    return "failed";
  }
}
