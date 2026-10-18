import { json, PlatformError, type Account, type Adapter } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"];

async function accessToken(refresh: string, env: NodeJS.ProcessEnv, f: typeof fetch): Promise<string> {
  const r = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID ?? "", client_secret: env.YOUTUBE_CLIENT_SECRET ?? "", refresh_token: refresh, grant_type: "refresh_token" }),
  });
  return (await json<{ access_token: string }>(r, "youtube token")).access_token;
}

export const youtube: Adapter = {
  platform: "youtube",
  missingEnv: (env) => ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"].filter((k) => !env[k]),
  authUrl: (state, redirectUri, env) =>
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", state }),
  async exchange(code, redirectUri, env, f) {
    const r = await f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.YOUTUBE_CLIENT_ID ?? "", client_secret: env.YOUTUBE_CLIENT_SECRET ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const t = await json<{ access_token: string; refresh_token?: string }>(r, "youtube exchange");
    if (!t.refresh_token) throw new PlatformError("youtube: no refresh token returned; revoke the app at myaccount.google.com/permissions and connect again", true);
    const ch = await json<{ items?: { id: string; snippet: { title: string } }[] }>(
      await f("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${t.access_token}` } }),
      "youtube channel",
    );
    const c = ch.items?.[0];
    return { label: c?.snippet.title ?? "YouTube channel", secret: t.refresh_token, extra: (c ? { channel_id: c.id } : {}) as Record<string, string> };
  },
  async publish(job, acct, env, f) {
    const token = await accessToken(acct.secret, env, f);
    // containsSyntheticMedia is YouTube's own "altered or synthetic content" disclosure; always on for our AI tracks.
    const meta = {
      snippet: { title: job.title, description: job.caption, categoryId: "10", tags: ["neofm", "AI music"] },
      status: { privacyStatus: job.visibility, selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    };
    const start = await f("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4" },
      body: JSON.stringify(meta),
    });
    if (!start.ok) {
      const body = await start.text();
      // quotaExceeded resets at midnight Pacific; leave the row queued rather than failing it.
      throw new PlatformError(`youtube start: HTTP ${start.status} ${body.slice(0, 300)}`, start.status === 400 || start.status === 401);
    }
    const loc = start.headers.get("location");
    if (!loc) throw new PlatformError("youtube: no upload location");
    const bytes = await job.loadBytes();
    const up = await json<{ id: string }>(
      await f(loc, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength) }, body: bytes as unknown as BodyInit }),
      "youtube upload",
    );
    const playlist = (env.YOUTUBE_PLAYLIST_ID ?? "").trim();
    if (playlist) {
      // Costs 50 quota units. A failure here must not hide that the video is already up, so it is reported, not thrown.
      const pl = await f("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ snippet: { playlistId: playlist, resourceId: { kind: "youtube#video", videoId: up.id } } }),
      });
      if (!pl.ok) console.warn("[social] youtube playlist add failed", pl.status);
    }
    return { externalId: up.id, url: `https://www.youtube.com/watch?v=${up.id}` };
  },
};

/**
 * Make an already-uploaded video public and make sure it sits in the configured playlist.
 * Used by the queue's `promote` action after S approves going public; costs about 51 quota units.
 */
export async function promoteYoutube(videoId: string, acct: Account, env: NodeJS.ProcessEnv, f: typeof fetch): Promise<{ playlist: "added" | "already" | "none" }> {
  const token = await accessToken(acct.secret, env, f);
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  await json(
    await f("https://www.googleapis.com/youtube/v3/videos?part=status", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ id: videoId, status: { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true } }),
    }),
    "youtube promote",
  );
  const playlist = (env.YOUTUBE_PLAYLIST_ID ?? "").trim();
  if (!playlist) return { playlist: "none" };
  const have = await json<{ items?: unknown[] }>(
    await f(`https://www.googleapis.com/youtube/v3/playlistItems?part=id&playlistId=${encodeURIComponent(playlist)}&videoId=${encodeURIComponent(videoId)}`, { headers: auth }),
    "youtube playlist check",
  );
  if ((have.items?.length ?? 0) > 0) return { playlist: "already" };
  await json(
    await f("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ snippet: { playlistId: playlist, resourceId: { kind: "youtube#video", videoId } } }),
    }),
    "youtube playlist add",
  );
  return { playlist: "added" };
}
