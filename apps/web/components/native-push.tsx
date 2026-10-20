"use client";

import { useEffect } from "react";

import { startNativePush } from "@/lib/native/push-bridge";

/** Mounted for signed-in users; does nothing outside the Android app or while the server has native push off. */
export function NativePush() {
  useEffect(() => {
    void startNativePush();
  }, []);
  return null;
}
