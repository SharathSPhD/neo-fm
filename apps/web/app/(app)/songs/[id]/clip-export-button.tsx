"use client";

/**
 * Makes a vertical (9:16) clip of the song in the browser, for Instagram Reels
 * and WhatsApp Status. Everything runs on the device: the excerpt is recorded
 * from a canvas while the song plays, so it takes about as long as the clip.
 */
import { useMemo, useRef, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { pickClipWindow } from "@/lib/share/clip-plan";
import { clipSupported, exportClip, type ExportedClip } from "@/lib/share/clip-export";
import { buildLyricTimeline, parseLineTimings, type SyncSectionInput } from "@/lib/lyrics/sync";

export interface ClipSource {
  audioUrl: string;
  sections: SyncSectionInput[];
  durationSeconds: number | null;
  lineTimings?: unknown;
}

export function ClipExportButton({
  songId,
  title,
  to,
  message,
  occasion,
  source,
}: {
  songId: string;
  title: string;
  to: string;
  message: string;
  /** Localised occasion label when the song came from /gift. */
  occasion?: string | null;
  source: ClipSource;
}) {
  const { t } = useUiLang();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<{ file: File; url: string; safe: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const lines = useMemo(
    () => buildLyricTimeline(source.sections, source.durationSeconds, parseLineTimings(source.lineTimings)),
    [source],
  );
  const total = source.durationSeconds ?? lines[lines.length - 1]?.end ?? 0;
  const supported = clipSupported();

  async function coverUrl(): Promise<string | null> {
    try {
      const res = await fetch(`/api/songs/${songId}/cover-art`, { cache: "no-store" });
      if (!res.ok) return null;
      return ((await res.json()) as { url: string | null }).url;
    } catch {
      return null;
    }
  }

  async function make() {
    if (busy) return;
    // Created inside the tap, before any await: iOS Safari keeps a context made later suspended.
    const audioContext = new AudioContext({ sampleRate: 48000 });
    await audioContext.resume().catch(() => undefined);
    setBusy(true);
    setError(null);
    setProgress(0);
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    abort.current = new AbortController();
    try {
      const out: ExportedClip = await exportClip({
        audioUrl: source.audioUrl,
        coverUrl: await coverUrl(),
        lines,
        window: pickClipWindow(lines, total),
        title,
        to: to.trim() ? t("clip.for", { to: to.trim() }) : null,
        occasion: occasion ?? null,
        message: message.trim() || null,
        seed: songId,
        audioContext,
        onProgress: setProgress,
        signal: abort.current.signal,
      });
      const file = new File([out.blob], `${title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "neo-fm"}.${out.ext}`, { type: out.blob.type });
      setClip({ file, url: URL.createObjectURL(out.blob), safe: out.instagramSafe });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message === "recorder_unsupported" ? t("clip.unsupported") : t("clip.failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function shareFile() {
    if (!clip) return;
    try {
      if (navigator.canShare?.({ files: [clip.file] })) {
        await navigator.share({ files: [clip.file], title });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(t("clip.failed"));
    }
  }

  if (!supported) return <p className="text-xs text-foreground/50">{t("clip.unsupported")}</p>;

  const canShareFile = typeof navigator !== "undefined" && !!clip && !!navigator.canShare?.({ files: [clip.file] });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-3" data-testid="clip-export">
      <span className="text-[10px] uppercase tracking-widest text-accent/80">{t("clip.heading")}</span>
      <p className="text-xs text-foreground/60">{t("clip.hint")}</p>
      {busy ? (
        <div className="flex flex-col gap-1" role="status">
          <progress value={progress} max={1} className="h-2 w-full accent-[hsl(var(--accent))]" aria-label={t("clip.making")} />
          <span className="text-xs text-foreground/60">{t("clip.keepOpen")}</span>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
      {clip ? (
        <video src={clip.url} controls playsInline className="mx-auto max-h-80 rounded-md" aria-label={t("clip.preview")} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={make}
          disabled={busy || total <= 0}
          className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/15 disabled:opacity-50"
        >
          {busy ? t("clip.making") : clip ? t("clip.again") : t("clip.make")}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="rounded-md border border-muted/30 px-3 py-1.5 text-xs hover:bg-muted/10"
          >
            {t("clip.cancel")}
          </button>
        ) : null}
        {clip ? (
          <>
            {canShareFile ? (
              <button
                type="button"
                onClick={shareFile}
                className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-400/15"
              >
                {t("clip.share")}
              </button>
            ) : null}
            <a
              href={clip.url}
              download={clip.file.name}
              className="rounded-md border border-muted/30 px-3 py-1.5 text-xs hover:bg-muted/10"
            >
              {t("clip.download")}
            </a>
          </>
        ) : null}
      </div>
      {clip && !clip.safe ? <p className="text-[10px] text-foreground/50">{t("clip.compatNote")}</p> : null}
    </div>
  );
}
