import type { serviceClient } from "../agent/adapters";
import type { Platform } from "./config";
import type { PublishStore, QueueRow } from "./publish";

type Db = ReturnType<typeof serviceClient>;
const BUCKET = "social-videos";

export function supabaseStore(db: Db): PublishStore {
  return {
    async due(platforms, limit) {
      const { data, error } = await db
        .from("social_posts")
        .select("id,platform,video_path,title,caption,visibility,needs_native_read,native_read_ok,approved_at,attempts")
        .eq("status", "approved")
        .in("platform", platforms)
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(limit);
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return "missing_table";
        throw new Error(`social_posts: ${error.message}`);
      }
      return (data ?? []) as QueueRow[];
    },
    async claim(id) {
      // Compare-and-set so two overlapping cron runs cannot upload the same row twice.
      const { data } = await db.from("social_posts").update({ status: "publishing" }).eq("id", id).eq("status", "approved").select("id");
      return (data?.length ?? 0) === 1;
    },
    async account(platform: Platform) {
      const { data } = await db.from("social_accounts").select("secret_sealed,extra").eq("platform", platform).maybeSingle();
      return data ? { secretSealed: String(data.secret_sealed), extra: (data.extra ?? {}) as Record<string, string> } : null;
    },
    async signedUrl(path) {
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error || !data) throw new Error(`signed url: ${error?.message ?? "none"}`);
      return data.signedUrl;
    },
    async finish(id, patch) {
      await db.from("social_posts").update({ ...patch, ...(patch.status === "published" ? { published_at: new Date().toISOString() } : {}) }).eq("id", id);
    },
  };
}
