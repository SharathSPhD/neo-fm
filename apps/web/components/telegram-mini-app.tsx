"use client";

/**
 * Wires the site into Telegram when it is opened as the @neo_fm_bot Mini App (t.me/neo_fm_bot/neofm).
 * Outside Telegram it renders nothing and loads nothing. No payments here: digital goods sold inside Telegram
 * must use Stars, which is a separate decision.
 */
import { useEffect } from "react";

import { hasTelegramLaunchParams, TELEGRAM_FLAG_KEY, TELEGRAM_SDK_URL } from "@/lib/telegram/mini-app";

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}

const THEME_COLOR = "#321656";

function remembered(): boolean {
  try {
    return sessionStorage.getItem(TELEGRAM_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function TelegramMiniApp() {
  useEffect(() => {
    const inTelegram = hasTelegramLaunchParams(window.location.hash) || remembered();
    if (!inTelegram) return;
    try {
      sessionStorage.setItem(TELEGRAM_FLAG_KEY, "1");
    } catch {
      // storage can be blocked; detection then relies on the launch hash alone
    }
    document.documentElement.dataset.telegram = "1";

    const start = () => {
      const app = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
      if (!app) return;
      app.ready();
      app.expand();
      app.setHeaderColor?.(THEME_COLOR);
      app.setBackgroundColor?.(THEME_COLOR);
    };

    if ((window as { Telegram?: unknown }).Telegram) {
      start();
      return;
    }
    const script = document.createElement("script");
    script.src = TELEGRAM_SDK_URL;
    script.async = true;
    script.onload = start;
    document.head.appendChild(script);
  }, []);
  return null;
}
