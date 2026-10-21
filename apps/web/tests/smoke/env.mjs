/** Single source of truth for the local smoke environment (build + runtime). */
export const FAKE_PORT = Number(process.env.SMOKE_FAKE_SUPABASE_PORT ?? 54399);
export const APP_PORT = Number(process.env.SMOKE_APP_PORT ?? 3100);

export const smokeEnv = {
  // `localhost` (not an IP) keeps the supabase cookie name stable: sb-localhost-auth-token.
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${FAKE_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "smoke-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "smoke-service-role-key",
  // Deterministic moderation rules: no Anthropic call, no spend.
  NEO_FM_MODERATION: "rules-only",
  // No Lyria / Anthropic / Upstash credentials on purpose.
  ANTHROPIC_API_KEY: "",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  // Finished features that ship dark on prod are exercised here so their path stays covered.
  STATION_DEDICATE: "1",
  STATION_PASS_MIX: "1",
  STATION_NOW_PLAYING: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};
