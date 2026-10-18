/**
 * Draws one frame of the vertical share clip. Canvas 2D only, so it runs in any
 * browser that can record a canvas. All layout is in a 1080x1920 design space and
 * scaled to the real canvas, which keeps the type sizes identical at any resolution.
 */
import { clipFrameState, wrapText, type ClipWindow } from "./clip-plan";
import type { SyncLine } from "@/lib/lyrics/sync";

export const CLIP_W = 720;
export const CLIP_H = 1280;
const DESIGN_W = 1080;

export interface ClipFrameInput {
  lines: readonly SyncLine[];
  window: ClipWindow;
  t: number;
  title: string;
  /** Ready-to-draw recipient line, already localised (e.g. "For Amma"). */
  to: string | null;
  /** Localised occasion label from /gift (e.g. "Diwali"); drawn as a small eyebrow above the title. */
  occasion: string | null;
  /** Dedication message, kept to one or two short lines. */
  message: string | null;
  cover: CanvasImageSource | null;
  /** Used to pick a deterministic gradient when there is no cover art. */
  seed: string;
  fontFamily: string;
  /** Loudness 0..1 and beat pulse 0..1 at `t`; both 0 when the audio could not be analysed. */
  energy?: number;
  pulse?: number;
}

function hueOf(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function drawClipFrame(ctx: CanvasRenderingContext2D, f: ClipFrameInput): void {
  const k = ctx.canvas.width / DESIGN_W;
  const W = DESIGN_W;
  const H = ctx.canvas.height / k;
  ctx.save();
  ctx.scale(k, k);

  const hue = hueOf(f.seed);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `hsl(${hue} 55% 22%)`);
  bg.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 8%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Two slow-drifting glows that swell with the music; motion is what makes it a video, not a slideshow.
  const energy = f.energy ?? 0;
  const pulse = f.pulse ?? 0;
  for (let i = 0; i < 2; i++) {
    const ang = f.t * (0.35 + 0.2 * i) + i * 2.4;
    const gx = W / 2 + Math.cos(ang) * 320;
    const gy = H * (0.35 + 0.3 * i) + Math.sin(ang * 1.3) * 200;
    const gr = 460 + 260 * energy + 120 * pulse;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    glow.addColorStop(0, `hsla(${(hue + 30 + 50 * i) % 360} 85% 55% / ${0.16 + 0.22 * energy})`);
    glow.addColorStop(1, `hsla(${(hue + 30 + 50 * i) % 360} 85% 55% / 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  // Cover art, square, with a soft shadow; the gradient stands in when it is missing.
  const side = 560;
  const cx = (W - side) / 2;
  const cy = 190;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  ctx.save();
  ctx.translate(W / 2, cy + side / 2);
  ctx.scale(1 + 0.035 * pulse, 1 + 0.035 * pulse);
  ctx.translate(-W / 2, -(cy + side / 2));
  ctx.fillStyle = `hsl(${(hue + 20) % 360} 50% 30%)`;
  roundRect(ctx, cx, cy, side, side, 36);
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (f.cover) {
    ctx.save();
    roundRect(ctx, cx, cy, side, side, 36);
    ctx.clip();
    ctx.drawImage(f.cover, cx, cy, side, side);
    ctx.restore();
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (f.occasion) {
    ctx.fillStyle = `hsl(${(hue + 25) % 360} 90% 75%)`;
    ctx.font = `600 32px ${f.fontFamily}`;
    fitLine(ctx, f.occasion.toLocaleUpperCase(), W / 2, cy + side + 52, W - 160);
  }
  ctx.fillStyle = "#fff";
  ctx.font = `600 54px ${f.fontFamily}`;
  fitLine(ctx, f.title, W / 2, cy + side + 90, W - 160);
  if (f.to) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `400 40px ${f.fontFamily}`;
    fitLine(ctx, f.to, W / 2, cy + side + 150, W - 160);
  }
  if (f.message) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `italic 34px ${f.fontFamily}`;
    fitLine(ctx, f.message, W / 2, cy + side + 204, W - 160);
  }

  // Lyric stack: previous line dim, active line large, next line dim.
  const st = clipFrameState(f.lines, f.window, f.t);
  const baseY = 1230;
  const rows: { line: SyncLine | undefined; size: number; alpha: number }[] = [
    { line: st.active > 0 ? f.lines[st.active - 1] : undefined, size: 40, alpha: 0.4 },
    { line: st.active >= 0 ? f.lines[st.active] : undefined, size: 62, alpha: 1 },
    { line: f.lines[st.active + 1], size: 40, alpha: 0.4 },
  ];
  let y = baseY;
  for (const row of rows) {
    if (!row.line) { y += row.size * 1.7; continue; }
    ctx.font = `${row === rows[1] ? 700 : 400} ${row.size}px ${f.fontFamily}`;
    const wrapped = wrapText((s) => ctx.measureText(s).width, row.line.text, W - 140).slice(0, 3);
    const isActive = row === rows[1];
    const accent = `hsl(${(hue + 25) % 360} 90% 72%)`;
    // Karaoke fill: the sung share of the line's characters is painted in the accent, left to right.
    const totalChars = wrapped.reduce((n, p) => n + p.length, 0) || 1;
    let before = 0;
    for (const part of wrapped) {
      if (!isActive) {
        ctx.fillStyle = `rgba(255,255,255,${row.alpha})`;
        ctx.fillText(part, W / 2, y);
      } else {
        const frac = Math.min(1, Math.max(0, (st.progress * totalChars - before) / Math.max(1, part.length)));
        const w = ctx.measureText(part).width;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(part, W / 2, y);
        if (frac > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(W / 2 - w / 2, y - row.size * 1.1, w * frac, row.size * 1.5);
          ctx.clip();
          ctx.fillStyle = accent;
          ctx.fillText(part, W / 2, y);
          ctx.restore();
        }
        before += part.length;
      }
      y += row.size * 1.3;
    }
    y += row.size * 0.4;
  }

  // Progress bar + brand; kept clear of the Reels / Status UI overlays (top 250, bottom 340 in the design space).
  const barY = H - 150;
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  roundRect(ctx, 120, barY, W - 240, 8, 4);
  ctx.fill();
  ctx.fillStyle = "#fff";
  roundRect(ctx, 120, barY, Math.max(8, (W - 240) * st.clipProgress), 8, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `500 34px ${f.fontFamily}`;
  ctx.fillText("neo.fm", W / 2, H - 80);

  ctx.restore();
}

function fitLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number): void {
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = `${t.slice(0, -2)}…`;
  ctx.fillText(t, x, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
