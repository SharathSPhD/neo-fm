"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Heart-shaped like button. Hosted on the public song page
 * (/s/[publicId]) and -- in v1.2 -- on /discover cards.
 *
 * Anonymous click sends the user to /sign-in?next=/s/<publicId>
 * because likes require auth (migration 0024).
 */
export function LikeButton({
  songId,
  publicId,
  initialLiked,
  initialCount,
  signedIn,
}: {
  songId: string;
  publicId: string;
  initialLiked: boolean;
  initialCount: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();

  function click() {
    if (!signedIn) {
      router.push(`/sign-in?next=/s/${publicId}`);
      return;
    }
    setLiked((v) => !v);
    setCount((c) => c + (liked ? -1 : 1));
    startTransition(async () => {
      const res = await fetch(`/api/songs/${songId}/like`, { method: "POST" });
      if (!res.ok) {
        setLiked((v) => !v);
        setCount((c) => c + (liked ? 1 : -1));
        return;
      }
      const data = (await res.json()) as {
        is_liked: boolean;
        like_count: number;
      };
      setLiked(data.is_liked);
      setCount(data.like_count);
    });
  }

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      className={
        liked
          ? "inline-flex items-center gap-2 rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-sm text-red-300 transition hover:bg-red-400/20 disabled:opacity-50"
          : "inline-flex items-center gap-2 rounded-full border border-muted/30 px-3 py-1 text-sm text-foreground/70 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"
      }
    >
      <span aria-hidden>{liked ? "♥" : "♡"}</span>
      <span>{count}</span>
    </button>
  );
}
