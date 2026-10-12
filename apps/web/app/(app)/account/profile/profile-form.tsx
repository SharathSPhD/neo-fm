"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { BIO_MAX_CHARS } from "@/lib/profile/bio";
import { AVATAR_MAX_BYTES } from "@/lib/profile/image";

const ERRORS: Record<string, string> = {
  too_long: `Keep it under ${BIO_MAX_CHARS} characters.`,
  links_not_allowed: "Links and email addresses aren't allowed in a bio.",
  bio_rejected: "That bio can't be used. Try rewording it.",
  moderation_unavailable: "The safety check is temporarily unavailable. Try again in a minute.",
  too_large: "That image is over 1 MB.",
  unsupported_type: "Use a PNG, JPEG or WebP image.",
  corrupt: "We couldn't read that image.",
  too_small: "The image must be at least 64 x 64 pixels.",
  too_big_dimensions: "The image must be at most 4096 x 4096 pixels.",
  avatar_rejected: "That image can't be used as a profile picture.",
  too_many_uploads: "Please wait a few seconds before uploading again.",
};

async function errorText(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return (data.error && ERRORS[data.error]) || "Something went wrong. Try again.";
}

export function ProfileForm({
  handle,
  initialBio,
  initialAvatarUrl,
}: {
  handle: string;
  initialBio: string;
  initialAvatarUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState(initialBio);
  const [avatar, setAvatar] = useState(initialAvatarUrl);
  const [bioMsg, setBioMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const remaining = BIO_MAX_CHARS - Array.from(bio).length;

  function saveBio(e: React.FormEvent) {
    e.preventDefault();
    setBioMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bio }),
      });
      if (!res.ok) return setBioMsg({ ok: false, text: await errorText(res) });
      setBioMsg({ ok: true, text: "Saved." });
      router.refresh();
    });
  }

  function upload(file: File) {
    setAvatarMsg(null);
    if (file.size > AVATAR_MAX_BYTES) return setAvatarMsg({ ok: false, text: ERRORS.too_large! });
    startTransition(async () => {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/account/avatar", { method: "POST", body });
      if (!res.ok) return setAvatarMsg({ ok: false, text: await errorText(res) });
      setAvatar(URL.createObjectURL(file));
      setAvatarMsg({ ok: true, text: "Picture updated." });
      router.refresh();
    });
  }

  function removeAvatar() {
    setAvatarMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/account/avatar", { method: "DELETE" });
      if (!res.ok) return setAvatarMsg({ ok: false, text: await errorText(res) });
      setAvatar(null);
      setAvatarMsg({ ok: true, text: "Picture removed." });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="avatar-h" className="flex items-center gap-4">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-supplied avatar from the public bucket
          <img src={avatar} alt="" width={80} height={80} className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <div aria-hidden className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/30 text-2xl">
            {handle.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <h2 id="avatar-h" className="text-sm font-medium">
            Profile picture
          </h2>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Choose a profile picture"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-muted/40 px-3 py-1.5 text-sm hover:border-accent/50 disabled:opacity-50"
            >
              {avatar ? "Replace" : "Upload"}
            </button>
            {avatar ? (
              <button
                type="button"
                disabled={pending}
                onClick={removeAvatar}
                className="rounded-md border border-muted/40 px-3 py-1.5 text-sm text-foreground/70 hover:border-accent/50 disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="text-xs text-foreground/60">PNG, JPEG or WebP, up to 1 MB, at least 64 x 64 px.</p>
          <p role="status" aria-live="polite" className={`text-xs ${avatarMsg?.ok ? "text-foreground/70" : "text-red-400"}`}>
            {avatarMsg?.text}
          </p>
        </div>
      </section>

      <form onSubmit={saveBio} className="flex flex-col gap-2">
        <label htmlFor="bio" className="text-sm font-medium">
          Bio
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          className="rounded-md border border-muted/30 bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
          aria-describedby="bio-help"
        />
        <div className="flex items-center justify-between">
          <p id="bio-help" className={`text-xs ${remaining < 0 ? "text-red-400" : "text-foreground/60"}`}>
            {remaining} characters left. No links or email addresses.
          </p>
          <button
            type="submit"
            disabled={pending || remaining < 0}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-background hover:bg-accent/90 disabled:opacity-50"
          >
            Save bio
          </button>
        </div>
        <p role="status" aria-live="polite" className={`text-xs ${bioMsg?.ok ? "text-foreground/70" : "text-red-400"}`}>
          {bioMsg?.text}
        </p>
      </form>
    </div>
  );
}
