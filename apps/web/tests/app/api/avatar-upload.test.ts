/**
 * POST /api/account/avatar: the 20 s spacing must hold under parallel requests, and a failed or
 * superseded upload must not leave a stored file behind.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  user: { avatar_path: "u1/old.png" as string | null, avatar_updated_at: null as string | null },
  uploaded: [] as string[],
  removed: [] as string[],
  moderate: vi.fn(),
  supersede: false,
}));

vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ user: { id: "u1" }, supabase: {} }) }));
vi.mock("@/lib/agent/adapters", () => ({ anthropicClient: () => ({}) }));
vi.mock("@/lib/profile/avatar-moderation", () => ({ moderateAvatar: st.moderate }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      let patch: Record<string, string> = {};
      let cutoff: string | null = null;
      let eqClaim: string | null = null;
      const q: Record<string, unknown> = {};
      q.update = (p: Record<string, string>) => { patch = p; return q; };
      q.eq = (col: string, v: string) => { if (col === "avatar_updated_at") eqClaim = v; return q; };
      q.or = (expr: string) => { cutoff = /lt\.(.+)$/.exec(expr)![1]!; return q; };
      q.select = () => q;
      q.returns = () => q;
      q.then = (res: (v: unknown) => unknown) => {
        // Emulates one atomic UPDATE ... WHERE; runs synchronously when awaited.
        const u = st.user;
        const claimOk = cutoff === null || u.avatar_updated_at === null || u.avatar_updated_at < cutoff;
        const casOk = eqClaim === null ? true : !st.supersede && u.avatar_updated_at === eqClaim;
        if (!claimOk || !casOk) return res({ data: [], error: null });
        const before = { avatar_path: u.avatar_path };
        Object.assign(u, patch);
        return res({ data: [cutoff !== null ? before : { id: "u1" }], error: null });
      };
      return q;
    },
    storage: {
      from: () => ({
        upload: async (p: string) => { st.uploaded.push(p); return { error: null }; },
        remove: async (ps: string[]) => { st.removed.push(...ps); return { error: null }; },
      }),
    },
  }),
}));

import { POST } from "@/app/api/account/avatar/route";

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (t: string) => [...t].map((c) => c.charCodeAt(0));
const chunk = (type: string, data: number[]) => [...be32(data.length), ...text(type), ...data, 0, 0, 0, 0];
function png(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...be32(64), ...be32(64), 8, 2, 0, 0, 0]),
    ...chunk("IDAT", [1, 2, 3]),
    ...chunk("IEND", []),
  ]);
}
function req() {
  const fd = new FormData();
  fd.set("file", new File([png().buffer as ArrayBuffer], "a.png", { type: "image/png" }));
  return new Request("http://x/api/account/avatar", { method: "POST", body: fd }) as never;
}

beforeEach(() => {
  st.user = { avatar_path: "u1/old.png", avatar_updated_at: null };
  st.uploaded = [];
  st.removed = [];
  st.supersede = false;
  st.moderate.mockReset().mockResolvedValue({ allowed: true });
});

describe("avatar upload throttle", () => {
  it("lets only one of several parallel uploads reach moderation", async () => {
    const res = await Promise.all([POST(req()), POST(req()), POST(req())]);
    const codes = res.map((r) => r.status).sort();
    expect(st.moderate).toHaveBeenCalledTimes(1);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
    expect(st.uploaded).toHaveLength(1);
    expect(st.removed).toEqual(["u1/old.png"]);
  });

  it("stores nothing when moderation rejects, and still spaces the next attempt", async () => {
    st.moderate.mockResolvedValue({ allowed: false, reason: "no" });
    expect((await POST(req())).status).toBe(422);
    expect(st.uploaded).toHaveLength(0);
    expect((await POST(req())).status).toBe(429);
  });

  it("removes its file when a newer claim superseded it", async () => {
    st.supersede = true;
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(st.removed).toEqual(st.uploaded);
    expect(st.user.avatar_path).toBe("u1/old.png");
  });
});
