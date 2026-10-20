"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { BIO_MAX_CHARS } from "@/lib/profile/bio";
import { AVATAR_MAX_BYTES } from "@/lib/profile/image";

type T = ReturnType<typeof useUiLang>["t"];

function errorMessage(t: T, code: string | undefined): string {
  switch (code) {
    case "too_long":
      return t("profedit.err.tooLong", { max: BIO_MAX_CHARS });
    case "links_not_allowed":
      return t("profedit.err.links");
    case "bio_rejected":
      return t("profedit.err.bioRejected");
    case "moderation_unavailable":
      return t("profedit.err.moderation");
    case "too_large":
      return t("profedit.err.tooLarge");
    case "unsupported_type":
      return t("profedit.err.unsupportedType");
    case "corrupt":
      return t("profedit.err.corrupt");
    case "too_small":
      return t("profedit.err.tooSmall");
    case "too_big_dimensions":
      return t("profedit.err.tooBig");
    case "avatar_rejected":
      return t("profedit.err.avatarRejected");
    case "too_many_uploads":
      return t("profedit.err.tooMany");
    default:
      return t("profedit.err.generic");
  }
}

async function errorText(t: T, res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return errorMessage(t, data.error);
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
  const { t } = useUiLang();
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
      if (!res.ok) return setBioMsg({ ok: false, text: await errorText(t, res) });
      setBioMsg({ ok: true, text: t("profedit.saved") });
      router.refresh();
    });
  }

  function upload(file: File) {
    setAvatarMsg(null);
    if (file.size > AVATAR_MAX_BYTES) return setAvatarMsg({ ok: false, text: errorMessage(t, "too_large") });
    startTransition(async () => {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/account/avatar", { method: "POST", body });
      if (!res.ok) return setAvatarMsg({ ok: false, text: await errorText(t, res) });
      setAvatar(URL.createObjectURL(file));
      setAvatarMsg({ ok: true, text: t("profedit.pictureUpdated") });
      router.refresh();
    });
  }

  function removeAvatar() {
    setAvatarMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/account/avatar", { method: "DELETE" });
      if (!res.ok) return setAvatarMsg({ ok: false, text: await errorText(t, res) });
      setAvatar(null);
      setAvatarMsg({ ok: true, text: t("profedit.pictureRemoved") });
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
            {t("profedit.pictureHeading")}
          </h2>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label={t("profedit.choosePicture")}
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
              {avatar ? t("profedit.replace") : t("profedit.upload")}
            </button>
            {avatar ? (
              <button
                type="button"
                disabled={pending}
                onClick={removeAvatar}
                className="rounded-md border border-muted/40 px-3 py-1.5 text-sm text-foreground/70 hover:border-accent/50 disabled:opacity-50"
              >
                {t("profedit.remove")}
              </button>
            ) : null}
          </div>
          <p className="text-xs text-foreground/60">{t("profedit.pictureHelp")}</p>
          <p role="status" aria-live="polite" className={`text-xs ${avatarMsg?.ok ? "text-foreground/70" : "text-red-400"}`}>
            {avatarMsg?.text}
          </p>
        </div>
      </section>

      <form onSubmit={saveBio} className="flex flex-col gap-2">
        <label htmlFor="bio" className="text-sm font-medium">
          {t("profedit.bio")}
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          className="rounded-xl border border-foreground/15 bg-foreground/5 px-3.5 py-2.5 text-sm focus:border-accent focus:outline-hidden"
          aria-describedby="bio-help"
        />
        <div className="flex items-center justify-between">
          <p id="bio-help" className={`text-xs ${remaining < 0 ? "text-red-400" : "text-foreground/60"}`}>
            {t("profedit.bioHelp", { n: remaining })}
          </p>
          <button
            type="submit"
            disabled={pending || remaining < 0}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-background hover:bg-accent/90 disabled:opacity-50"
          >
            {t("profedit.saveBio")}
          </button>
        </div>
        <p role="status" aria-live="polite" className={`text-xs ${bioMsg?.ok ? "text-foreground/70" : "text-red-400"}`}>
          {bioMsg?.text}
        </p>
      </form>
    </div>
  );
}
