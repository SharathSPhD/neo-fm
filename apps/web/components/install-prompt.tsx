"use client";

import { useEffect, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { parseAppShell } from "@/lib/native/app-shell";

const DISMISS_KEY = "neo-fm:install-dismissed-at";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Inside the store app or Telegram there is nothing to install, so the banner never applies. */
function inHostedApp(): boolean {
  return parseAppShell(navigator.userAgent) !== null || Boolean((window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
}

/** iPhone, iPod and iPad, including iPadOS which reports a Mac user agent. */
function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Boolean(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * Install banner. Chromium browsers hand us `beforeinstallprompt`; iOS
 * Safari has no such event, so there we show the manual "Add to Home
 * Screen" hint. Hidden once installed or after "Not now" (14 days).
 * `minPlays`/`plays` hold it back until the listener has heard that many
 * tracks, so the station asks only after it has earned the ask.
 */
export function InstallPrompt({ plays = Infinity, minPlays = 0 }: { plays?: number; minPlays?: number } = {}) {
  const { t } = useUiLang();
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone() || snoozed() || inHostedApp()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      // Chromium can re-fire this after "Not now"; the snooze must win.
      if (snoozed()) return;
      setDeferred(e as InstallEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (isIosDevice()) {
      setIos(true);
      setHidden(false);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // best effort
    }
    setDeferred(null);
    setIos(false);
    setHidden(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setHidden(true);
  }

  if (hidden || plays < minPlays || (!deferred && !ios)) return null;

  return (
    <aside
      aria-label={t("install.title")}
      data-testid="install-prompt"
      className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("install.title")}</p>
        <p className="text-foreground/70">
          {deferred ? t("install.body") : t("install.ios")}
        </p>
      </div>
      {deferred ? (
        <button
          type="button"
          onClick={install}
          className="min-h-[44px] rounded-md bg-accent px-4 text-sm font-medium text-background"
        >
          {t("install.cta")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        className="min-h-[44px] px-3 text-sm text-foreground/70 hover:text-foreground"
      >
        {t("install.dismiss")}
      </button>
    </aside>
  );
}
