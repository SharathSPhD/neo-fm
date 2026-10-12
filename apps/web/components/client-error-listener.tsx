"use client";

/** Reports uncaught errors and unhandled promise rejections that React boundaries never see (event handlers, async code). */
import { useEffect } from "react";

import { reportClientError } from "@/lib/obs/report-client-error";

export function ClientErrorListener() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, { boundary: "window" });
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, { boundary: "promise" });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
