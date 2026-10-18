import type { serviceClient } from "../../agent/adapters";
import type { Platform } from "../config";
import { open, seal } from "../crypto";
import type { AccountSeed } from "../platforms/types";

type Db = ReturnType<typeof serviceClient>;
export type Mode = "neofm_app" | "own_app";

export interface Connection {
  platform: Platform;
  mode: Mode;
  label: string;
  connected_at: string;
}

const missing = (code?: string) => code === "42P01" || code === "PGRST205";

/** Safe fields only; the sealed token never leaves this module. "unavailable" means the migration is not applied. */
export async function listConnections(db: Db, userId: string): Promise<Connection[] | "unavailable"> {
  const { data, error } = await db.from("user_social_accounts").select("platform,mode,label,connected_at").eq("user_id", userId);
  if (error) {
    if (missing(error.code)) return "unavailable";
    throw new Error(`user_social_accounts: ${error.message}`);
  }
  return (data ?? []) as Connection[];
}

export async function saveConnection(db: Db, userId: string, platform: Platform, mode: Mode, seed: AccountSeed, env = process.env): Promise<boolean> {
  const { error } = await db
    .from("user_social_accounts")
    .upsert({ user_id: userId, platform, mode, label: seed.label, secret_sealed: seal(seed.secret, env), extra: seed.extra, connected_at: new Date().toISOString() });
  return !error;
}

export async function removeConnection(db: Db, userId: string, platform: Platform): Promise<void> {
  // Own-app credentials go with the connection so a disconnect leaves nothing sealed behind.
  await db.from("user_social_accounts").delete().eq("user_id", userId).eq("platform", platform);
  await db.from("user_social_apps").delete().eq("user_id", userId).eq("platform", platform);
}

export async function saveOwnApp(db: Db, userId: string, platform: Platform, clientId: string, clientSecret: string, env = process.env): Promise<boolean> {
  const { error } = await db
    .from("user_social_apps")
    .upsert({ user_id: userId, platform, client_id_sealed: seal(clientId, env), client_secret_sealed: seal(clientSecret, env), updated_at: new Date().toISOString() });
  return !error;
}

export async function loadOwnApp(db: Db, userId: string, platform: Platform, env = process.env): Promise<{ clientId: string; clientSecret: string } | null> {
  const { data } = await db.from("user_social_apps").select("client_id_sealed,client_secret_sealed").eq("user_id", userId).eq("platform", platform).maybeSingle();
  if (!data) return null;
  return { clientId: open(String(data.client_id_sealed), env), clientSecret: open(String(data.client_secret_sealed), env) };
}
