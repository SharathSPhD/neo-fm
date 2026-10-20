/**
 * iOS launch images for the installed web app. Safari picks one by exact device width, height and pixel ratio, so the
 * table must match scripts/gen-splash.py (portrait only; landscape launches show the plain background).
 */
export const SPLASH: readonly (readonly [width: number, height: number, ratio: number])[] = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [375, 812, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2],
  [1024, 1366, 2], [834, 1194, 2], [820, 1180, 2], [810, 1080, 2], [744, 1133, 2],
];

export const startupImages = SPLASH.map(([w, h, r]) => ({
  url: `/splash/${w * r}x${h * r}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
}));
