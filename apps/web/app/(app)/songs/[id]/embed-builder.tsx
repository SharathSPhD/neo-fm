"use client";

/**
 * Embed code generator inside the share modal: pick layout, theme and
 * width, see the player as it will look, copy the iframe snippet.
 */
import { useState } from "react";

import type { UiKey } from "@/lib/i18n/ui-strings";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import {
  EMBED_HEIGHT,
  embedIframeHtml,
  embedPath,
  type EmbedLayout,
  type EmbedTheme,
} from "@/lib/embed/options";

const LAYOUTS: { value: EmbedLayout; label: UiKey }[] = [
  { value: "full", label: "embedb.full" },
  { value: "compact", label: "embedb.compact" },
];
const THEMES: { value: EmbedTheme; label: UiKey }[] = [
  { value: "auto", label: "embedb.auto" },
  { value: "light", label: "embedb.light" },
  { value: "dark", label: "embedb.dark" },
];
const WIDTHS: { value: string; label: UiKey | null; px: number | null }[] = [
  { value: "fluid", label: "embedb.fluid", px: null },
  { value: "480", label: null, px: 480 },
  { value: "640", label: null, px: 640 },
];

export function EmbedBuilder({
  publicId,
  title,
  origin,
}: {
  publicId: string;
  title: string;
  origin: string;
}) {
  const { t } = useUiLang();
  const [layout, setLayout] = useState<EmbedLayout>("full");
  const [theme, setTheme] = useState<EmbedTheme>("auto");
  const [width, setWidth] = useState("fluid");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const px = WIDTHS.find((w) => w.value === width)?.px ?? null;
  const code = embedIframeHtml({ origin, publicId, title, options: { layout, theme }, width: px });

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 1800);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-widest text-foreground/60">{t("embedb.heading")}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <Segment name={t("embedb.layout")} options={LAYOUTS} value={layout} onChange={setLayout} />
        <Segment name={t("embedb.theme")} options={THEMES} value={theme} onChange={setTheme} />
        <Segment name={t("embedb.width")} options={WIDTHS} value={width} onChange={setWidth} />
      </div>
      <div className="overflow-hidden rounded-md border border-muted/30">
        <iframe
          key={`${layout}-${theme}`}
          src={embedPath(publicId, { layout, theme })}
          title={t("embedb.previewTitle")}
          width={px ?? "100%"}
          height={EMBED_HEIGHT[layout]}
          style={{ border: 0, maxWidth: "100%" }}
          loading="lazy"
        />
      </div>
      <textarea
        readOnly
        aria-label={t("embedb.codeLabel")}
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        rows={4}
        className="w-full rounded-md border border-muted/30 bg-muted/10 px-3 py-2 font-mono text-[10px]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-foreground/60">
          {t("embedb.hint")}
        </span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/15"
        >
          {copied === "copied" ? t("embedb.copied") : copied === "failed" ? t("embedb.failed") : t("embedb.copy")}
        </button>
      </div>
    </div>
  );
}

function Segment<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: T; label: UiKey | null }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { t } = useUiLang();
  return (
    <div role="radiogroup" aria-label={name} className="flex items-center gap-1">
      <span className="mr-1 text-foreground/60">{name}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-2 py-1 ${
            o.value === value
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-muted/30 text-foreground/70 hover:bg-muted/10"
          }`}
        >
          {o.label ? t(o.label) : `${o.value} px`}
        </button>
      ))}
    </div>
  );
}
