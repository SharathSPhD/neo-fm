import type { Platform } from "../config";
import type { UserTier } from "../../agent/tiers";

/** Listener-connected accounts. Off unless LISTENER_SOCIAL_ENABLED=1; independent of the studio's SOCIAL_PUBLISH_ENABLED. */
export const listenerSocialEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.LISTENER_SOCIAL_ENABLED === "1";

/** Creator, Pro and developer tiers may attach their own developer app; free listeners use neo-fm's shared app. */
export const canUseOwnApp = (tier: UserTier | null | undefined): boolean => tier === "creator" || tier === "pro" || tier === "developer";

export type ShareRoute = "api" | "api_private" | "share_sheet";

/**
 * How a listener's share reaches each platform today. The API routes depend on app review we do not have yet, so the
 * share sheet (always available) is the floor:
 * - youtube: neo-fm's app is unverified (uploads stay private and capped) until Google's audit; an own app is private too.
 * - tiktok: unaudited apps may only post SELF_ONLY.
 * - instagram/facebook: publishing needs Meta app review (instagram_content_publish, pages_manage_posts) and a professional account.
 */
export function shareRoute(platform: Platform, env: NodeJS.ProcessEnv = process.env): ShareRoute {
  const reviewed = (env.LISTENER_SOCIAL_REVIEWED ?? "").split(",").map((s) => s.trim());
  if (reviewed.includes(platform)) return "api";
  return platform === "youtube" || platform === "tiktok" ? "api_private" : "share_sheet";
}

/** Env var names holding each platform's app credentials (shared by neo-fm's app and, per listener, their own). */
export const APP_ENV: Record<Platform, { id: string; secret: string }> = {
  youtube: { id: "YOUTUBE_CLIENT_ID", secret: "YOUTUBE_CLIENT_SECRET" },
  tiktok: { id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },
  instagram: { id: "META_APP_ID", secret: "META_APP_SECRET" },
  facebook: { id: "META_APP_ID", secret: "META_APP_SECRET" },
};

/** Env with one listener's own app credentials swapped in, so the existing adapters work unchanged. */
export function envWithApp(env: NodeJS.ProcessEnv, platform: Platform, clientId: string, clientSecret: string): NodeJS.ProcessEnv {
  const k = APP_ENV[platform];
  return { ...env, [k.id]: clientId, [k.secret]: clientSecret };
}
