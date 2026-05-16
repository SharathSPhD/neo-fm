/**
 * /u/[handle] -- public profile page (Sprint G).
 *
 * Resolves a handle -> user_id via the unauthenticated
 * `public_profiles` view (migration 0023), then lists that user's
 * public songs from `public.jobs` filtered by visibility. RLS does
 * the gating server-side; this page can be fully indexed by search
 * engines.
 *
 * Shows: handle, member-since, follower count, follow/unfollow
 * button (client island), and a paginated grid of public songs.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

import { FollowButton } from "./follow-button";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

type Props = {
  params: { handle: string };
  searchParams: { page?: string };
};

export async function generateMetadata({
  params,
}: {
  params: { handle: string };
}): Promise<Metadata> {
  const handle = params.handle.toLowerCase();
  return {
    title: `@${handle} -- neo-fm`,
    description: `Songs by @${handle} on neo-fm.`,
    openGraph: {
      title: `@${handle} -- neo-fm`,
      description: `Songs by @${handle}`,
    },
  };
}

type ProfileRow = {
  id: string;
  handle: string;
  created_at: string;
};

type SongRow = {
  id: string;
  public_id: string;
  published_at: string | null;
  song_documents: {
    title: string | null;
    language: string;
    style_family: string;
  } | null;
};

export default async function ProfilePage({ params, searchParams }: Props) {
  const supabase = createServerClient();
  const handle = params.handle.toLowerCase();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Cast: `public_profiles` view isn't in the generated Database
  // types yet (migration 0023 just landed). Type the view shape locally.
  const profileLookup = await (
    supabase.from("public_profiles" as never) as unknown as {
      select: (s: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          maybeSingle: () => Promise<{
            data: ProfileRow | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .select("id, handle, created_at")
    .eq("handle", handle)
    .maybeSingle();

  if (profileLookup.error || !profileLookup.data) {
    notFound();
  }
  const profile = profileLookup.data;

  const [songsRes, followerCountRes, currentUserRes, isFollowingRes] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          `
          id, public_id, published_at,
          song_documents!inner ( title, language, style_family )
        `,
        )
        .eq("user_id", profile.id)
        .eq("status", "completed")
        .eq("published_visibility", "public")
        .not("public_id", "is", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1)
        .returns<SongRow[]>(),
      (
        supabase.from("follows" as never) as unknown as {
          select: (
            s: string,
            opts: { count: "exact"; head: true },
          ) => {
            eq: (
              col: string,
              val: string,
            ) => Promise<{ count: number | null }>;
          };
        }
      )
        .select("followee_id", { count: "exact", head: true })
        .eq("followee_id", profile.id),
      supabase.auth.getUser(),
      (async () => {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) return { data: false };
        const probe = await (
          supabase.from("follows" as never) as unknown as {
            select: (s: string) => {
              eq: (
                col: string,
                val: string,
              ) => {
                eq: (
                  col2: string,
                  val2: string,
                ) => {
                  maybeSingle: () => Promise<{ data: unknown }>;
                };
              };
            };
          }
        )
          .select("follower_id")
          .eq("follower_id", auth.user.id)
          .eq("followee_id", profile.id)
          .maybeSingle();
        return { data: !!probe.data };
      })(),
    ]);

  const songs = songsRes.data ?? [];
  const followerCount = followerCountRes.count ?? 0;
  const currentUserId = currentUserRes.data.user?.id ?? null;
  const isFollowing = isFollowingRes.data ?? false;
  const isSelf = currentUserId === profile.id;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          profile
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-4xl font-medium tracking-tight">
              @{profile.handle}
            </h1>
            <p className="text-sm text-foreground/55">
              {followerCount}{" "}
              {followerCount === 1 ? "follower" : "followers"} · joined{" "}
              {new Date(profile.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
              })}
            </p>
          </div>
          {currentUserId && !isSelf ? (
            <FollowButton
              userId={profile.id}
              initialFollowing={isFollowing}
              initialCount={followerCount}
            />
          ) : null}
          {isSelf ? (
            <Link
              href="/onboarding/handle"
              className="rounded-md border border-muted/30 px-3 py-1.5 text-xs text-foreground/70 hover:border-accent/30 hover:text-foreground"
            >
              Change handle
            </Link>
          ) : null}
        </div>
      </header>

      {songs.length === 0 ? (
        <p className="rounded-md border border-dashed border-muted/30 px-6 py-12 text-center text-sm text-foreground/60">
          {isSelf
            ? "You haven't published any songs yet."
            : `@${profile.handle} hasn't published any songs yet.`}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {songs.map((row) => {
            const doc = row.song_documents;
            const title =
              doc?.title?.trim() ||
              (doc ? `${prettyStyle(doc.style_family)} song` : "Song");
            return (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border border-muted/20 bg-muted/5 p-4 transition hover:border-accent/30"
              >
                <Link
                  href={`/s/${row.public_id}`}
                  className="text-base font-medium hover:text-accent"
                >
                  {title}
                </Link>
                <p className="text-xs text-foreground/55">
                  {doc ? prettyStyle(doc.style_family) : "—"}
                  {doc ? ` · ${prettyLanguage(doc.language)}` : ""}
                </p>
                {row.published_at ? (
                  <p className="text-[11px] text-foreground/35">
                    {new Date(row.published_at).toLocaleDateString()}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {songs.length === PAGE_SIZE || page > 1 ? (
        <nav className="flex items-center justify-center gap-2 text-sm">
          {page > 1 ? (
            <Link
              href={`/u/${profile.handle}?page=${page - 1}`}
              className="rounded-md border border-muted/30 px-3 py-1.5 hover:border-accent/30"
            >
              ← Prev
            </Link>
          ) : null}
          <span className="px-3 text-foreground/60">Page {page}</span>
          {songs.length === PAGE_SIZE ? (
            <Link
              href={`/u/${profile.handle}?page=${page + 1}`}
              className="rounded-md border border-muted/30 px-3 py-1.5 hover:border-accent/30"
            >
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
