"use client";

import { useState, useTransition } from "react";

export function FollowButton({
  userId,
  initialFollowing,
  initialCount,
}: {
  userId: string;
  initialFollowing: boolean;
  initialCount: number;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    setFollowing((v) => !v);
    setCount((c) => c + (following ? -1 : 1));
    startTransition(async () => {
      const res = await fetch(`/api/users/${userId}/follow`, { method: "POST" });
      if (!res.ok) {
        setFollowing((v) => !v);
        setCount((c) => c + (following ? 1 : -1));
        const text = await res.text().catch(() => "");
        setError(text || "Couldn't update follow.");
        return;
      }
      const data = (await res.json()) as {
        is_following: boolean;
        follower_count: number;
      };
      setFollowing(data.is_following);
      setCount(data.follower_count);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={
          following
            ? "rounded-md border border-muted/40 px-4 py-1.5 text-sm text-foreground/80 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"
            : "rounded-md border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
        }
      >
        {following ? "Following" : "Follow"}
      </button>
      <span className="text-[10px] text-foreground/40">
        {count} {count === 1 ? "follower" : "followers"}
      </span>
      {error ? (
        <span className="text-[10px] text-red-300">{error}</span>
      ) : null}
    </div>
  );
}
