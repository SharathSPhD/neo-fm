/**
 * Minimal in-memory stand-in for Supabase (GoTrue + PostgREST) used by the
 * local smoke suite, so the real production build can run end to end with
 * no network, no real data and no paid generation.
 *
 * Everything the app writes is recorded and readable at GET /__calls, so
 * specs can assert "a job was queued" without any real database.
 */
import { createServer } from "node:http";

import { DEDICATED, FIXTURE_JOBS } from "./fixtures.mjs";

export const PORT = Number(process.env.SMOKE_FAKE_SUPABASE_PORT ?? 54399);
export const PUBLIC_ID = "smkpb23456"; // 10 chars; the alphabet excludes i, l, o, u
const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "smoke@neo-fm.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const TOKEN = "smoke-access-token";

const calls = [];
const session = () => ({
  access_token: TOKEN,
  refresh_token: "smoke-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: USER,
});

const PUBLIC_JOB = {
  id: "00000000-0000-4000-8000-0000000000aa",
  status: "completed",
  public_id: PUBLIC_ID,
  published_at: "2026-01-01T00:00:00Z",
  published_visibility: "public",
  song_documents: {
    language: "hi",
    style_family: "bollywood-ballad",
    title: "Smoke Test Song",
    document_json: {
      style_family: "bollywood-ballad",
      language: "hi",
      target_duration_seconds: 30,
      sections: [{ type: "verse", lyrics: "smoke test lyric", target_seconds: 30 }],
    },
  },
  tracks: [],
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...CORS, ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : null; } catch { return raw; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
  const rowOrEmpty = (row) =>
    wantsObject
      ? row
        ? send(res, 200, row)
        : send(res, 406, { code: "PGRST116", message: "no rows", details: "", hint: "" })
      : send(res, 200, row ? [row] : []);

  if (req.method === "OPTIONS") return send(res, 204);
  if (path === "/__calls") return send(res, 200, calls);
  if (path === "/__health") return send(res, 200, { ok: true });

  const body = req.method === "GET" ? null : await readBody(req);
  if (req.method !== "GET") calls.push({ method: req.method, path, body });

  // ---- GoTrue ----
  if (path === "/auth/v1/user") {
    const ok = req.headers.authorization === `Bearer ${TOKEN}`;
    return ok ? send(res, 200, USER) : send(res, 401, { msg: "not signed in" });
  }
  if (path === "/auth/v1/token") return send(res, 200, session());
  if (path === "/auth/v1/signup") {
    // Mirrors prod: email confirmation required, so no session yet.
    return send(res, 200, { ...USER, email: body?.email ?? USER.email, confirmation_sent_at: new Date().toISOString() });
  }
  if (path === "/auth/v1/logout") return send(res, 204);

  // ---- PostgREST ----
  if (path === "/rest/v1/rpc/create_song_job") {
    return send(res, 200, [{ job_id: "00000000-0000-4000-8000-0000000000bb", status: "queued", song_id: "00000000-0000-4000-8000-0000000000cc" }]);
  }
  if (req.method === "GET" && path === "/rest/v1/jobs" && url.searchParams.get("public_id")?.startsWith("eq.")) {
    const id = url.searchParams.get("public_id").slice(3);
    // Dedication lives in its own query (see lib/share/load.ts).
    if ((url.searchParams.get("select") ?? "").includes("dedication_to")) {
      return rowOrEmpty(id === DEDICATED.publicId ? { dedication_to: DEDICATED.to, dedication_message: DEDICATED.message } : null);
    }
    return rowOrEmpty(id === PUBLIC_ID ? PUBLIC_JOB : (FIXTURE_JOBS[id] ?? null));
  }
  if (req.method === "GET") return rowOrEmpty(null);
  // Inserts / updates / deletes: acknowledge, recorded above.
  return send(res, 201, []);
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake supabase on :${PORT}`));
