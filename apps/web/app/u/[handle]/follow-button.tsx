"use client";

import { useState, useTransition } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

export function FollowButton({
  userId,
  initialFollowing,
  initialCount,
}: {
  userId: string;
  initialFollowing: boolean;
  initialCount: number;
}) {
  const { t } = useUiLang();
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
        setError(text || t("pub.follow.error"));
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
        {following ? t("pub.follow.following") : t("pub.follow.follow")}
      </button>
      <span className="text-[10px] text-foreground/40">
        {count === 1 ? t("pub.follow.followers.one", { n: count }) : t("pub.follow.followers.other", { n: count })}
      </span>
      {error ? (
        <span className="text-[10px] text-red-300">{error}</span>
      ) : null}
    </div>
  );
}
