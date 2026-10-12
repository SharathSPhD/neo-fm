"use client";

/**
 * <ShareButton> -- owner-only share modal on /songs/[id].
 *
 * Opens a modal with three visibility options + actions:
 *   - Public  (listed on /discover; anyone with link can play)
 *   - Unlisted (link-only; default)
 *   - Private (revokes the share; link 404s)
 *
 * Clicking a visibility option calls `POST /api/songs/[id]/publish`
 * (ADR 0013). On success we surface:
 *   - the public URL  /s/[publicId]
 *   - a "copy link" button
 *   - an "embed code" snippet (iframe pointing at /s/[publicId]/embed)
 */
import { useEffect, useRef, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { buildSharePayload } from "@/lib/share/card";
import {
  DEDICATION_MESSAGE_MAX,
  DEDICATION_TO_MAX,
  whatsappShareUrl,
} from "@/lib/share/dedication";

interface ShareButtonProps {
  songId: string;
  initialVisibility: "public" | "unlisted" | "private";
  initialPublicId: string | null;
  title?: string;
  initialDedication?: { to: string; message: string };
  canShare: boolean; // false for non-completed songs
}

interface PublishResponse {
  public_id: string | null;
  visibility: "public" | "unlisted" | "private";
  published_at: string | null;
  public_url: string | null;
}

export function ShareButton({
  songId,
  initialVisibility,
  initialPublicId,
  title = "this song",
  initialDedication = { to: "", message: "" },
  canShare,
}: ShareButtonProps) {
  const { t } = useUiLang();
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [publicId, setPublicId] = useState<string | null>(initialPublicId);
  const [publicUrl, setPublicUrl] = useState<string | null>(
    initialPublicId && initialVisibility !== "private"
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${initialPublicId}`
      : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [dedTo, setDedTo] = useState(initialDedication.to);
  const [dedMsg, setDedMsg] = useState(initialDedication.message);
  const [dedSaved, setDedSaved] = useState(
    initialDedication.to.length > 0,
  );
  const [dedBusy, setDedBusy] = useState(false);
  const [dedError, setDedError] = useState<string | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Focus Done on open so keyboard users can close immediately.
    doneButtonRef.current?.focus();
  }, [open]);

  async function setTo(target: "public" | "unlisted" | "private") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/songs/${songId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: target }),
      });
      const payload = (await res.json()) as PublishResponse & {
        error?: string;
      };
      if (!res.ok) {
        setError(payload.error ?? t("share.requestFailed", { status: res.status }));
        return;
      }
      setVisibility(payload.visibility);
      setPublicId(payload.public_id);
      setPublicUrl(payload.public_url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function saveDedication(clear: boolean) {
    if (dedBusy) return;
    setDedBusy(true);
    setDedError(null);
    try {
      const res = await fetch(`/api/songs/${songId}/dedication`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          clear ? { to: null, message: null } : { to: dedTo, message: dedMsg },
        ),
      });
      const payload = (await res.json()) as {
        to?: string | null;
        message?: string | null;
        error?: string;
        reason?: string;
      };
      if (!res.ok) {
        setDedError(
          payload.error === "content_blocked"
            ? (payload.reason ?? t("ded.errBlocked"))
            : payload.error === "recipient_required" || payload.error === "invalid_body"
              ? t("ded.errRecipient")
              : t("ded.errSave", { status: res.status }),
        );
        return;
      }
      setDedTo(payload.to ?? "");
      setDedMsg(payload.message ?? "");
      setDedSaved(!!payload.to);
    } catch (e) {
      setDedError((e as Error).message);
    } finally {
      setDedBusy(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 1500);
    }
  }

  async function shareNatively(url: string) {
    // Web Share API where available (mobile, Safari); otherwise the
    // same copy-link path as the Copy button.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(buildSharePayload(title, url));
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    await copyToClipboard(url);
  }

  if (!canShare) {
    return (
      <span
        className="rounded-md border border-muted/20 bg-muted/5 px-3 py-1.5 text-[11px] uppercase tracking-widest text-foreground/40"
        title={t("share.unavailable")}
      >
        {t("share.share")}
      </span>
    );
  }

  const embedCode = publicId
    ? `<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/s/${publicId}/embed" width="100%" height="180" frameborder="0" allow="autoplay; encrypted-media"></iframe>`
    : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest text-accent hover:bg-accent/15"
      >
        {visibility === "private" ? t("share.share") : t("share.manage")}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-muted/30 bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-medium tracking-tight">
                {t("share.title")}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-foreground/40 hover:text-foreground/80"
                aria-label={t("share.close")}
              >
                ×
              </button>
            </header>

            <div className="flex flex-col gap-2 text-xs">
              <VisibilityRow
                value="public"
                current={visibility}
                title={t("share.public")}
                description={t("share.publicDesc")}
                onClick={() => setTo("public")}
                disabled={submitting}
              />
              <VisibilityRow
                value="unlisted"
                current={visibility}
                title={t("share.unlisted")}
                description={t("share.unlistedDesc")}
                onClick={() => setTo("unlisted")}
                disabled={submitting}
              />
              <VisibilityRow
                value="private"
                current={visibility}
                title={t("share.private")}
                description={t("share.privateDesc")}
                onClick={() => setTo("private")}
                disabled={submitting}
              />
            </div>

            {error ? (
              <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            ) : null}

            {publicUrl && visibility !== "private" ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-widest text-foreground/40">
                    {t("share.publicLink")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={publicUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 rounded-md border border-muted/30 bg-muted/10 px-3 py-2 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => shareNatively(publicUrl)}
                      className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent hover:bg-accent/15"
                    >
                      Share…
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(publicUrl)}
                      className="rounded-md border border-muted/30 px-3 py-2 text-xs hover:bg-muted/10"
                    >
                      {copyState === "copied"
                        ? t("share.copied")
                        : copyState === "failed"
                          ? t("share.failed")
                          : t("share.copy")}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-3">
                  <span className="text-[10px] uppercase tracking-widest text-accent/80">
                    {t("ded.heading")}
                  </span>
                  <input
                    value={dedTo}
                    onChange={(e) => setDedTo(e.target.value)}
                    maxLength={DEDICATION_TO_MAX}
                    placeholder={t("ded.toPlaceholder")}
                    aria-label={t("ded.toLabel")}
                    className="rounded-md border border-muted/30 bg-muted/10 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={dedMsg}
                    onChange={(e) => setDedMsg(e.target.value)}
                    maxLength={DEDICATION_MESSAGE_MAX}
                    rows={3}
                    placeholder={t("ded.msgPlaceholder")}
                    aria-label={t("ded.msgLabel")}
                    className="rounded-md border border-muted/30 bg-muted/10 px-3 py-2 text-sm"
                  />
                  {dedError ? (
                    <p role="alert" className="text-xs text-red-300">{dedError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => saveDedication(false)}
                      disabled={dedBusy || dedTo.trim().length === 0}
                      className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/15 disabled:opacity-50"
                    >
                      {dedSaved ? t("ded.update") : t("ded.save")}
                    </button>
                    {dedSaved ? (
                      <button
                        type="button"
                        onClick={() => saveDedication(true)}
                        disabled={dedBusy}
                        className="rounded-md border border-muted/30 px-3 py-1.5 text-xs hover:bg-muted/10 disabled:opacity-50"
                      >
                        {t("ded.remove")}
                      </button>
                    ) : null}
                  </div>
                  {dedSaved ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={whatsappShareUrl({
                          to: dedTo,
                          title,
                          url: publicUrl,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-400/15"
                      >
                        {t("ded.whatsapp")}
                      </a>
                      <a
                        href={`/s/${publicId}/story?download=1`}
                        className="rounded-md border border-muted/30 px-3 py-1.5 text-xs hover:bg-muted/10"
                      >
                        {t("ded.story")}
                      </a>
                    </div>
                  ) : null}
                  <p className="text-[10px] text-foreground/50">
                    {t("ded.note")}
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-widest text-foreground/40">
                    {t("share.embed")}
                  </label>
                  <textarea
                    readOnly
                    value={embedCode}
                    onFocus={(e) => e.currentTarget.select()}
                    rows={3}
                    className="w-full rounded-md border border-muted/30 bg-muted/10 px-3 py-2 font-mono text-[10px]"
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-foreground/50">
                {visibility === "private"
                  ? t("share.privateNote")
                  : t("share.publishing")}
              </p>
            )}

            <div className="flex justify-end">
              <button
                ref={doneButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-accent/40 bg-accent/10 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-accent hover:bg-accent/15"
              >
                {t("share.done")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function VisibilityRow({
  value,
  current,
  title,
  description,
  onClick,
  disabled,
}: {
  value: "public" | "unlisted" | "private";
  current: "public" | "unlisted" | "private";
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-left transition ${
        active
          ? "border-accent bg-accent/10"
          : "border-muted/20 bg-muted/5 hover:bg-muted/15"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`mt-[2px] h-3 w-3 flex-none rounded-full border ${
          active ? "border-accent bg-accent" : "border-muted/50"
        }`}
        aria-hidden="true"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[11px] text-foreground/60">{description}</span>
      </span>
    </button>
  );
}
