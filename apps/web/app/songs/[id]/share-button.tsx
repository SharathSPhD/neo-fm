"use client";

/**
 * <ShareButton> -- owner-only share modal on /songs/[id].
 *
 * Opens a modal with three visibility options + actions:
 *   - Public  (listed once /explore exists; anyone with link can play)
 *   - Unlisted (link-only; default)
 *   - Private (revokes the share; link 404s)
 *
 * Clicking a visibility option calls `POST /api/songs/[id]/publish`
 * (ADR 0013). On success we surface:
 *   - the public URL  /s/[publicId]
 *   - a "copy link" button
 *   - an "embed code" snippet (iframe pointing at /s/[publicId]/embed)
 */
import { useState } from "react";

interface ShareButtonProps {
  songId: string;
  initialVisibility: "public" | "unlisted" | "private";
  initialPublicId: string | null;
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
  canShare,
}: ShareButtonProps) {
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
        setError(payload.error ?? `request failed (${res.status})`);
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

  if (!canShare) {
    return (
      <span
        className="rounded-md border border-muted/20 bg-muted/5 px-3 py-1.5 text-[11px] uppercase tracking-widest text-foreground/40"
        title="Share is available once the song has finished rendering."
      >
        Share
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
        {visibility === "private" ? "Share" : "Manage share"}
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
                Share this song
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-foreground/40 hover:text-foreground/80"
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className="flex flex-col gap-2 text-xs">
              <VisibilityRow
                value="public"
                current={visibility}
                title="Public"
                description="Anyone with the link can play. Will show on /explore."
                onClick={() => setTo("public")}
                disabled={submitting}
              />
              <VisibilityRow
                value="unlisted"
                current={visibility}
                title="Unlisted"
                description="Anyone with the link can play. Not listed publicly."
                onClick={() => setTo("unlisted")}
                disabled={submitting}
              />
              <VisibilityRow
                value="private"
                current={visibility}
                title="Private"
                description="Only you can see this song. Shared links stop working."
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
                    Public link
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
                      onClick={() => copyToClipboard(publicUrl)}
                      className="rounded-md border border-muted/30 px-3 py-2 text-xs hover:bg-muted/10"
                    >
                      {copyState === "copied"
                        ? "Copied"
                        : copyState === "failed"
                          ? "Failed"
                          : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-widest text-foreground/40">
                    Embed (iframe)
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
                  ? "This song is private. Set it to Unlisted or Public to share."
                  : "Publishing…"}
              </p>
            )}
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
