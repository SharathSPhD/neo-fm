/**
 * /u/[handle] -- public creator profile.
 *
 * Resolves a handle -> user_id via the `public_profiles` view (id, handle, created_at only),
 * then lists that user's public songs grouped by language. No bio or play counts: neither is
 * stored, and the view is deliberately limited to three columns.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";

import { serverI18n } from "@/lib/i18n/server";
import { jsonLdString, musicPlaylistLd } from "@/lib/seo/jsonld";
import { siteUrl } from "@/lib/seo/site";
import { createServerClient } from "@/lib/supabase/server";
import { CoverArt } from "@/components/cover-art";
import { avatarUrl } from "@/lib/profile/avatar-url";
import {
  avatarColors,
  avatarInitial,
  groupByLanguage,
  profileBlurb,
  profileStats,
  type ProfileSong,
} from "@/lib/profile/summary";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

import { FollowButton } from "./follow-button";
import { ShareProfileButton } from "./share-profile-button";

export const dynamic = "force-dynamic";

// A profile shows up to this many songs, grouped by language. Beyond it we would need paging per group.
const MAX_SONGS = 200;

type Props = {
  params: { handle: string };
};

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const handle = params.handle.toLowerCase();
  const title = `@${handle} on neo-fm`;
  const data = await loadProfile(handle);
  // Unknown handles and empty profiles are not worth indexing.
  const indexable = Boolean(data && data.songs.length > 0);
  const description = data?.profile.bio
    ? data.profile.bio
    : data
    ? profileBlurb(
        handle,
        profileStats(data.songs),
        groupByLanguage(data.songs).map((g) => prettyLanguage(g.language)),
      )
    : `Songs by @${handle} on neo-fm.`;
  return {
    title,
    description,
    alternates: { canonical: `/u/${handle}` },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

type ProfileRow = {
  id: string;
  handle: string;
  created_at: string;
  bio: string | null;
  avatar_path: string | null;
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

/** Profile row plus public songs (with like counts), or null for an unknown handle. */
const loadProfile = cache(async function loadProfile(handle: string) {
  const supabase = createServerClient();
  const lookup = await (
    supabase.from("public_profiles" as never) as unknown as {
      select: (s: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: ProfileRow | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .select("id, handle, created_at, bio, avatar_path")
    .eq("handle", handle)
    .maybeSingle();
  if (lookup.error || !lookup.data) return null;
  const profile = lookup.data;

  const songsRes = await supabase
    .from("jobs")
    .select("id, public_id, published_at, song_documents!inner ( title, language, style_family )")
    .eq("user_id", profile.id)
    .eq("status", "completed")
    .eq("published_visibility", "public")
    .not("public_id", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_SONGS)
    .returns<SongRow[]>();
  const rows = (songsRes.data ?? []).filter((r) => r.song_documents);

  // One head-count query instead of fetching like rows; song_likes is readable by everyone (policy song_likes_select_all).
  let totalLikes = 0;
  if (rows.length > 0) {
    const likes = await supabase
      .from("song_likes")
      .select("job_id", { count: "exact", head: true })
      .in("job_id", rows.map((r) => r.id));
    totalLikes = likes.count ?? 0;
  }

  const songs: ProfileSong[] = rows.map((r) => ({
    id: r.id,
    public_id: r.public_id,
    published_at: r.published_at,
    title: r.song_documents?.title ?? null,
    language: r.song_documents?.language ?? "en",
    style_family: r.song_documents?.style_family ?? "western",
    like_count: 0,
  }));
  return { profile, songs, totalLikes };
});

export default async function ProfilePage({ params }: Props) {
  const { t } = serverI18n();
  const supabase = createServerClient();
  const handle = params.handle.toLowerCase();

  const loaded = await loadProfile(handle);
  if (!loaded) notFound();
  const { profile, songs, totalLikes } = loaded;

  const [followerCountRes, authRes] = await Promise.all([
    (
      supabase.from("follows" as never) as unknown as {
        select: (s: string, opts: { count: "exact"; head: true }) => {
          eq: (col: string, val: string) => Promise<{ count: number | null }>;
        };
      }
    )
      .select("followee_id", { count: "exact", head: true })
      .eq("followee_id", profile.id),
    supabase.auth.getUser(),
  ]);
  const followerCount = followerCountRes.count ?? 0;
  const currentUserId = authRes.data.user?.id ?? null;
  const isSelf = currentUserId === profile.id;

  let isFollowing = false;
  if (currentUserId && !isSelf) {
    const probe = await (
      supabase.from("follows" as never) as unknown as {
        select: (s: string) => {
          eq: (c: string, v: string) => {
            eq: (c2: string, v2: string) => { maybeSingle: () => Promise<{ data: unknown }> };
          };
        };
      }
    )
      .select("follower_id")
      .eq("follower_id", currentUserId)
      .eq("followee_id", profile.id)
      .maybeSingle();
    isFollowing = Boolean(probe.data);
  }

  const stats = { ...profileStats(songs), likes: totalLikes };
  const groups = groupByLanguage(songs);
  const shareText = profileBlurb(
    profile.handle,
    stats,
    groups.map((g) => prettyLanguage(g.language)),
  );

  const playlistLd =
    songs.length > 0
      ? musicPlaylistLd({
          base: siteUrl(),
          path: `/u/${profile.handle}`,
          name: `Songs by @${profile.handle}`,
          description: shareText,
          tracks: songs.map((s) => ({ publicId: s.public_id, name: s.title?.trim() || `${prettyStyle(s.style_family)} song`, language: s.language })),
        })
      : null;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      {playlistLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(playlistLd) }} />
      ) : null}
      <header className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {avatarUrl(profile.avatar_path) ? (
          // eslint-disable-next-line @next/next/no-img-element -- user avatar from the public bucket
          <img
            src={avatarUrl(profile.avatar_path) ?? ""}
            alt={`@${profile.handle}`}
            width={96}
            height={96}
            className="h-24 w-24 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full text-4xl font-semibold text-white"
            style={{ backgroundImage: `linear-gradient(135deg, ${avatarColors(profile.handle).from}, ${avatarColors(profile.handle).to})` }}
          >
            {avatarInitial(profile.handle)}
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2">
          <h1 className="text-4xl font-medium tracking-tight">@{profile.handle}</h1>
          <p className="text-sm text-foreground/60">
            <span data-testid="follower-count">{followerCount}</span>{" "}
            {t(followerCount === 1 ? "profile.follower" : "profile.followers", { n: "" }).trim()} · {t("profile.joined")}{" "}
            {new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })}
          </p>
          {profile.bio ? <p className="max-w-prose whitespace-pre-line text-sm text-foreground/85">{profile.bio}</p> : null}
          {stats.songs > 0 ? (
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground/80">
              <li>
                <strong className="font-semibold">{stats.songs}</strong> {stats.songs === 1 ? "song" : "songs"}
              </li>
              <li>
                <strong className="font-semibold">{stats.languages}</strong>{" "}
                {stats.languages === 1 ? "language" : "languages"}
              </li>
              <li>
                <strong className="font-semibold">{stats.likes}</strong> {stats.likes === 1 ? "like" : "likes"}
              </li>
            </ul>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {currentUserId && !isSelf ? (
              <FollowButton userId={profile.id} initialFollowing={isFollowing} initialCount={followerCount} />
            ) : null}
            {!currentUserId ? (
              <Link
                href={`/sign-in?next=${encodeURIComponent(`/u/${profile.handle}`)}`}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                Sign in to follow
              </Link>
            ) : null}
            {isSelf ? (
              <Link
                href="/account/profile"
                className="rounded-md border border-muted/30 px-3 py-1.5 text-xs text-foreground/70 hover:border-accent/30 hover:text-foreground"
              >
                {t("profile.editProfile")}
              </Link>
            ) : null}
            <ShareProfileButton handle={profile.handle} text={shareText} />
          </div>
        </div>
      </header>

      {songs.length === 0 ? (
        <p className="rounded-md border border-dashed border-muted/30 px-6 py-12 text-center text-sm text-foreground/60">
          {isSelf
            ? t("profile.noneSelf")
            : t("profile.noneOther", { handle: profile.handle })}
        </p>
      ) : (
        <>
          {groups.length > 1 ? (
            <nav aria-label="Jump to language" className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <a
                  key={g.language}
                  href={`#lang-${g.language}`}
                  className="rounded-full border border-muted/40 px-3 py-1 text-xs text-foreground/80 hover:border-accent/50 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {prettyLanguage(g.language)} · {g.songs.length}
                </a>
              ))}
            </nav>
          ) : null}
          {groups.map((g) => (
            <section key={g.language} id={`lang-${g.language}`} aria-labelledby={`h-${g.language}`} className="scroll-mt-6">
              <h2 id={`h-${g.language}`} className="mb-4 text-xl font-medium tracking-tight">
                {prettyLanguage(g.language)}{" "}
                <span className="text-sm font-normal text-foreground/60">
                  {g.songs.length} {g.songs.length === 1 ? "song" : "songs"}
                </span>
              </h2>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.songs.map((song) => {
                  const title = song.title?.trim() || `${prettyStyle(song.style_family)} song`;
                  return (
                    <li key={song.id}>
                      <Link
                        href={`/s/${song.public_id}`}
                        className="group flex gap-3 rounded-lg border border-muted/20 bg-muted/5 p-3 transition hover:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent"
                      >
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md">
                          <CoverArt url={null} seed={song.id} styleFamily={song.style_family} alt="" showGlyph />
                        </div>
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-base font-medium group-hover:text-accent">{title}</p>
                          <p className="mt-0.5 text-xs text-foreground/60">
                            {prettyStyle(song.style_family)}
                          </p>
                          {song.published_at ? (
                            <p className="text-[11px] text-foreground/50">
                              {new Date(song.published_at).toLocaleDateString()}
                            </p>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="text-xs text-foreground/50">AI-generated music and lyrics, made on neo-fm.</p>
        </>
      )}
    </main>
  );
}
