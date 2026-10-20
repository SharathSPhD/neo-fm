/**
 * Coarse time-of-day bands used to tint the ambient background so the
 * station feels like it follows the listener's day. Four bands on purpose:
 * the station's own dayparts are finer, but the UI only needs a mood.
 */
export type UiDaypart = "dawn" | "day" | "dusk" | "night";

export function uiDaypart(hour: number): UiDaypart {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 9) return "dawn";
  if (h >= 9 && h < 16) return "day";
  if (h >= 16 && h < 20) return "dusk";
  return "night";
}
