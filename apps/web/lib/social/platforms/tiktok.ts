import { json, PlatformError, type Adapter } from "./types";

const API = "https://open.tiktokapis.com/v2";

async function accessToken(refresh: string, env: NodeJS.ProcessEnv, f: typeof fetch): Promise<string> {
  const r = await f(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY ?? "", client_secret: env.TIKTOK_CLIENT_SECRET ?? "", grant_type: "refresh_token", refresh_token: refresh }),
  });
  return (await json<{ access_token: string }>(r, "tiktok token")).access_token;
}

export const tiktok: Adapter = {
  platform: "tiktok",
  missingEnv: (env) => ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"].filter((k) => !env[k]),
  authUrl: (state, redirectUri, env) =>
    "https://www.tiktok.com/v2/auth/authorize/?" + new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY ?? "", scope: "user.info.basic,video.publish", response_type: "code", redirect_uri: redirectUri, state }),
  async exchange(code, redirectUri, env, f) {
    const t = await json<{ refresh_token?: string; open_id?: string }>(
      await f(`${API}/oauth/token/`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY ?? "", client_secret: env.TIKTOK_CLIENT_SECRET ?? "", code, grant_type: "authorization_code", redirect_uri: redirectUri }),
      }),
      "tiktok exchange",
    );
    if (!t.refresh_token) throw new PlatformError("tiktok: no refresh token returned", true);
    return { label: "TikTok account", secret: t.refresh_token, extra: (t.open_id ? { open_id: t.open_id } : {}) as Record<string, string> };
  },
  async publish(job, acct, env, f) {
    const token = await accessToken(acct.secret, env, f);
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" };
    const info = await json<{ data?: { privacy_level_options?: string[] } }>(await f(`${API}/post/publish/creator_info/query/`, { method: "POST", headers: auth }), "tiktok creator info");
    // Unaudited apps may only post SELF_ONLY; ask for public only when the creator's options include it.
    const wantPublic = job.visibility === "public" && info.data?.privacy_level_options?.includes("PUBLIC_TO_EVERYONE");
    const bytes = await job.loadBytes();
    const size = bytes.byteLength;
    if (size > 64 * 1024 * 1024) throw new PlatformError("tiktok: file over 64 MB single-chunk limit", true);
    const init = await json<{ data: { publish_id: string; upload_url: string } }>(
      await f(`${API}/post/publish/video/init/`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          // is_aigc is TikTok's "AI-generated content" label.
          post_info: { title: job.caption.slice(0, 2200), privacy_level: wantPublic ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY", is_aigc: true },
          source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
        }),
      }),
      "tiktok init",
    );
    const put = await f(init.data.upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-range": `bytes 0-${size - 1}/${size}` }, body: bytes as unknown as BodyInit });
    if (!put.ok) throw new PlatformError(`tiktok upload: HTTP ${put.status}`);
    return { externalId: init.data.publish_id, url: null };
  },
};
