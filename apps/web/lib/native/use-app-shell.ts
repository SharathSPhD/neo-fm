"use client";

import { useEffect, useState } from "react";

import { type AppShell, parseAppShell } from "./app-shell";

/** null on the server and on first paint (so hydration matches), then the shell once mounted. */
export function useAppShell(): AppShell | null {
  const [shell, setShell] = useState<AppShell | null>(null);
  useEffect(() => setShell(parseAppShell(navigator.userAgent)), []);
  return shell;
}
