"use client";

/**
 * Embed code generator inside the share modal: pick layout, theme and
 * width, see the player as it will look, copy the iframe snippet.
 */
import { useState } from "react";

import {
  EMBED_HEIGHT,
  embedIframeHtml,
  embedPath,
  type EmbedLayout,
  type EmbedTheme,
} from "@/lib/embed/options";

const LAYOUTS: { value: EmbedLayout; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "compact", label: "Compact" },
];
const THEMES: { value: EmbedTheme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const WIDTHS: { value: string; label: string; px: number | null }[] = [
  { value: "fluid", label: "Fluid", px: null },
  { value: "480", label: "480 px", px: 480 },
  { value: "640", label: "640 px", px: 640 },
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
      <span className="text-[10px] uppercase tracking-widest text-foreground/60">Embed on your site</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <Segment name="Layout" options={LAYOUTS} value={layout} onChange={setLayout} />
        <Segment name="Theme" options={THEMES} value={theme} onChange={setTheme} />
        <Segment name="Width" options={WIDTHS} value={width} onChange={setWidth} />
      </div>
      <div className="overflow-hidden rounded-md border border-muted/30">
        <iframe
          key={`${layout}-${theme}`}
          src={embedPath(publicId, { layout, theme })}
          title="Embed preview"
          width={px ?? "100%"}
          height={EMBED_HEIGHT[layout]}
          style={{ border: 0, maxWidth: "100%" }}
          loading="lazy"
        />
      </div>
      <textarea
        readOnly
        aria-label="Embed code"
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        rows={4}
        className="w-full rounded-md border border-muted/30 bg-muted/10 px-3 py-2 font-mono text-[10px]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-foreground/60">
          Paste into any page that allows HTML, or just paste the song link into Notion or Substack.
        </span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/15"
        >
          {copied === "copied" ? "Copied" : copied === "failed" ? "Failed" : "Copy code"}
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
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
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
          {o.label}
        </button>
      ))}
    </div>
  );
}
