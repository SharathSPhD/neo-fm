"use client";

import { useEffect, useState } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

/** Thin offline strip; playback already loaded keeps working. */
export function NetworkBanner() {
  const { t } = useUiLang();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-200"
    >
      {t("net.offline")}
    </div>
  );
}
