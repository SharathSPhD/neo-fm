import type { Platform } from "../config";

export type Fetch = typeof fetch;
export type Visibility = "private" | "public";

/** What the connect flow stores (the secret part is sealed before it reaches the database). */
export interface AccountSeed {
  label: string;
  /** Refresh token (YouTube, TikTok) or the long-lived page token (Meta). */
  secret: string;
  extra: Record<string, string>;
}

export interface Account {
  secret: string;
  extra: Record<string, string>;
}

export interface PublishJob {
  title: string;
  caption: string;
  visibility: Visibility;
  /** Short-lived signed URL for platforms that pull the file. */
  videoUrl: string;
  /** Loaded lazily; only platforms that push bytes call it. */
  loadBytes: () => Promise<Uint8Array>;
}

export interface PublishResult {
  externalId: string;
  url: string | null;
}

export interface Adapter {
  platform: Platform;
  /** Missing client id/secret etc. Never returns the values. */
  missingEnv: (env: NodeJS.ProcessEnv) => string[];
  authUrl: (state: string, redirectUri: string, env: NodeJS.ProcessEnv) => string;
  exchange: (code: string, redirectUri: string, env: NodeJS.ProcessEnv, f: Fetch) => Promise<AccountSeed>;
  publish: (job: PublishJob, acct: Account, env: NodeJS.ProcessEnv, f: Fetch) => Promise<PublishResult>;
}

export class PlatformError extends Error {
  constructor(
    message: string,
    /** Retrying cannot help (bad scope, rejected content, quota exhausted until tomorrow). */
    readonly permanent = false,
  ) {
    super(message);
  }
}

export async function json<T>(r: Response, what: string): Promise<T> {
  const text = await r.text();
  if (!r.ok) throw new PlatformError(`${what}: HTTP ${r.status} ${text.slice(0, 300)}`, r.status >= 400 && r.status < 500 && r.status !== 429);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PlatformError(`${what}: non-JSON response`);
  }
}
