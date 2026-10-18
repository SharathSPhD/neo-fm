"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { giftShareUrl } from "@/lib/gift/occasions";
import { useUiLang } from "@/lib/i18n/use-ui-lang";

interface PublishResponse {
  public_id: string | null;
  public_url: string | null;
  error?: string;
}

/**
 * The finished gift: publishes the song as unlisted (link-only) the first time it is opened, then offers the
 * WhatsApp send, the link and the story image. Unlisted is the existing owner-chosen share mode (ADR 0013).
 */
export function GiftShare({
  songId,
  to,
  occasionLabel,
  initialPublicId,
  dedicationFailed,
}: {
  songId: string;
  to: string;
  occasionLabel: string;
  initialPublicId: string | null;
  dedicationFailed: boolean;
}) {
  const { t } = useUiLang();
  const [publicId, setPublicId] = useState(initialPublicId);
  const [publicUrl, setPublicUrl] = useState<string | null>(
    initialPublicId ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${initialPublicId}` : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (publicId || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/songs/${songId}/publish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ visibility: "unlisted" }),
        });
        const body = (await res.json()) as PublishResponse;
        if (!res.ok || !body.public_id) {
          setError(t("gift.errGeneric"));
          return;
        }
        setPublicId(body.public_id);
        setPublicUrl(body.public_url ?? `${window.location.origin}/s/${body.public_id}`);
      } catch {
        setError(t("gift.errGeneric"));
      }
    })();
  }, [publicId, songId, t]);

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the link stays visible to copy by hand
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <p className="text-xs uppercase tracking-widest text-foreground/50">{occasionLabel}</p>
        <h1 className="text-3xl font-medium tracking-tight">{t("gift.ready", { name: to })}</h1>
      </header>

      {dedicationFailed ? (
        <p role="alert" className="text-sm text-amber-300">
          {t("gift.dedicationFailed")}{" "}
          <Link href={`/songs/${songId}`} className="underline">{t("gift.openSong")}</Link>
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}

      {publicUrl && publicId ? (
        <div className="flex flex-col gap-3">
          <a
            href={giftShareUrl({ name: to, occasion: occasionLabel, url: publicUrl })}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90"
          >
            {t("ded.whatsapp")}
          </a>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="min-h-[44px] rounded-md border border-muted/30 px-4 text-sm hover:border-accent/60">
              {copied ? t("gift.copied") : t("share.copy")}
            </button>
            <a href={`/s/${publicId}/story`} className="inline-flex min-h-[44px] items-center rounded-md border border-muted/30 px-4 text-sm hover:border-accent/60">
              {t("ded.story")}
            </a>
            <Link href={`/s/${publicId}`} className="inline-flex min-h-[44px] items-center rounded-md border border-muted/30 px-4 text-sm hover:border-accent/60">
              {t("gift.preview")}
            </Link>
          </div>
          <p className="text-xs text-foreground/50">{t("gift.shareNote")}</p>
        </div>
      ) : error ? null : (
        <p role="status" className="text-sm text-foreground/60">{t("gift.preparing")}</p>
      )}
    </div>
  );
}
