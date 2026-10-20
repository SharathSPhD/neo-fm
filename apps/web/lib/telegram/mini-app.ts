/**
 * Telegram Mini App detection. Telegram opens the bot's web app URL with a `#tgWebAppData=...&tgWebAppVersion=...`
 * hash, so the hash (or a flag saved from an earlier load in the same tab, because in-app navigation drops the hash)
 * is how we know we are inside Telegram. Outside Telegram nothing here runs and no Telegram script is fetched.
 */
export const TELEGRAM_SDK_URL = "https://telegram.org/js/telegram-web-app.js";
export const TELEGRAM_FLAG_KEY = "neo-fm:telegram-mini-app";

/** Origins that frame Mini Apps on Telegram Web; the native apps use a webview and need no framing rule. */
export const TELEGRAM_FRAME_ORIGINS = [
  "https://web.telegram.org",
  "https://webk.telegram.org",
  "https://webz.telegram.org",
];

export function hasTelegramLaunchParams(hash: string): boolean {
  if (!hash.startsWith("#")) return false;
  const params = new URLSearchParams(hash.slice(1));
  return params.has("tgWebAppData") || params.has("tgWebAppVersion");
}
