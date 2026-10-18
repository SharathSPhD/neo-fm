import { json, PlatformError, type Account, type AccountSeed, type Adapter, type PublishJob, type PublishResult, type Fetch } from "./types";
import type { Platform } from "../config";

const GRAPH = "https://graph.facebook.com/v21.0";
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Facebook Login for Business apps take a `config_id` (set META_CONFIG_ID) in place of `scope`. */
function authUrl(state: string, redirectUri: string, env: NodeJS.ProcessEnv): string {
  const configId = (env.META_CONFIG_ID ?? "").trim();
  const base = { client_id: env.META_APP_ID ?? "", redirect_uri: redirectUri, state, response_type: "code" };
  return "https://www.facebook.com/v21.0/dialog/oauth?" + new URLSearchParams(configId ? { ...base, config_id: configId } : { ...base, scope: SCOPES.join(",") });
}

/** Code -> long-lived user token -> never-expiring page token, plus the linked Instagram professional account. */
async function exchange(code: string, redirectUri: string, env: NodeJS.ProcessEnv, f: Fetch): Promise<AccountSeed> {
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const short = await json<{ access_token: string }>(
    await f(`${GRAPH}/oauth/access_token?${q({ client_id: env.META_APP_ID ?? "", client_secret: env.META_APP_SECRET ?? "", redirect_uri: redirectUri, code })}`),
    "meta exchange",
  );
  const long = await json<{ access_token: string }>(
    await f(`${GRAPH}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: env.META_APP_ID ?? "", client_secret: env.META_APP_SECRET ?? "", fb_exchange_token: short.access_token })}`),
    "meta long-lived",
  );
  const pages = await json<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string } }[] }>(
    await f(`${GRAPH}/me/accounts?${q({ fields: "id,name,access_token,instagram_business_account", access_token: long.access_token })}`),
    "meta pages",
  );
  const want = (env.META_PAGE_ID ?? "").trim();
  let page = pages.data.find((p) => (want ? p.id === want : true));
  if (!page && want) {
    // Business-portfolio Pages are not always listed by /me/accounts; ask for the configured Page directly.
    const direct = await f(`${GRAPH}/${encodeURIComponent(want)}?${q({ fields: "id,name,access_token,instagram_business_account", access_token: long.access_token })}`);
    if (direct.ok) {
      const d = (await direct.json()) as { id?: string; name?: string; access_token?: string; instagram_business_account?: { id: string } };
      if (d.id && d.access_token) page = { id: d.id, name: d.name ?? "Page", access_token: d.access_token, instagram_business_account: d.instagram_business_account };
    }
  }
  if (!page) throw new PlatformError("meta: no Facebook Page found for this login (create the Page and make this user an admin)", true);
  return {
    label: `${page.name}${page.instagram_business_account ? " + Instagram" : ""}`,
    secret: page.access_token,
    extra: { page_id: page.id, ...(page.instagram_business_account ? { ig_user_id: page.instagram_business_account.id } : {}) },
  };
}

async function instagram(job: PublishJob, acct: Account, f: Fetch) {
  const ig = acct.extra.ig_user_id;
  if (!ig) throw new PlatformError("instagram: no Instagram professional account linked to the Page", true);
  const c = await json<{ id: string }>(
    await f(`${GRAPH}/${ig}/media`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ media_type: "REELS", video_url: job.videoUrl, caption: job.caption, share_to_feed: "true", access_token: acct.secret }),
    }),
    "instagram container",
  );
  for (let i = 0; i < 20; i++) {
    const s = await json<{ status_code: string }>(await f(`${GRAPH}/${c.id}?fields=status_code&access_token=${encodeURIComponent(acct.secret)}`), "instagram status");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new PlatformError(`instagram processing ${s.status_code}`, true);
    await sleep(3000);
    if (i === 19) throw new PlatformError("instagram: video still processing; try next run");
  }
  const p = await json<{ id: string }>(
    await f(`${GRAPH}/${ig}/media_publish`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: c.id, access_token: acct.secret }) }),
    "instagram publish",
  );
  return { externalId: p.id, url: null };
}

async function facebook(job: PublishJob, acct: Account, f: Fetch) {
  const page = acct.extra.page_id;
  if (!page) throw new PlatformError("facebook: no Page connected", true);
  const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...o, access_token: acct.secret }) });
  const start = await json<{ video_id: string; upload_url: string }>(await f(`${GRAPH}/${page}/video_reels`, form({ upload_phase: "start" })), "facebook reel start");
  // Hosted-file upload: Facebook pulls the file from the signed URL.
  await json(await f(start.upload_url, { method: "POST", headers: { authorization: `OAuth ${acct.secret}`, file_url: job.videoUrl } }), "facebook reel upload");
  await json(await f(`${GRAPH}/${page}/video_reels`, form({ upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description: job.caption })), "facebook reel finish");
  return { externalId: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
}

const missingEnv = (env: NodeJS.ProcessEnv) => ["META_APP_ID", "META_APP_SECRET"].filter((k) => !env[k]);

const make = (platform: Platform, run: (job: PublishJob, acct: Account, f: Fetch) => Promise<PublishResult>): Adapter => ({
  platform,
  missingEnv,
  authUrl,
  exchange,
  // Meta has no private reel: callers must only reach here for approved, public posts (publish.ts enforces it).
  publish: (job, acct, _env, f) => run(job, acct, f),
});

export const instagramAdapter = make("instagram", instagram);
export const facebookAdapter = make("facebook", facebook);
