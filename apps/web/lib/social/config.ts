/** Kill switches for the video publisher. Everything is off unless an env var says otherwise. */
export const PLATFORMS = ["youtube", "instagram", "facebook", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const isPlatform = (v: string): v is Platform => (PLATFORMS as readonly string[]).includes(v);

export interface SocialFlags {
  /** Master switch: when false the cron does nothing and says so. */
  enabled: boolean;
  /** Platforms listed in SOCIAL_PLATFORMS (comma separated); empty means none. */
  platforms: Platform[];
  /** Public visibility is allowed only with this second flag; otherwise uploads stay private / self-only. */
  allowPublic: boolean;
  /** Uploads per cron run, so one tick never burns a platform's daily quota. */
  perRun: number;
}

export function socialFlags(env: NodeJS.ProcessEnv = process.env): SocialFlags {
  const list = (env.SOCIAL_PLATFORMS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(isPlatform);
  const perRun = Number(env.SOCIAL_PER_RUN ?? "1");
  return {
    enabled: env.SOCIAL_PUBLISH_ENABLED === "1",
    platforms: list,
    allowPublic: env.SOCIAL_ALLOW_PUBLIC === "1",
    perRun: Number.isFinite(perRun) && perRun >= 1 ? Math.min(Math.floor(perRun), 5) : 1,
  };
}
