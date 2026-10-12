"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Invisible: polls each unfinished job (which is what advances it server-side) and refreshes the page when one
 * finishes. Mounted by the library whenever any song is queued/processing.
 */
export function ActiveJobsWatcher({ jobIds }: { jobIds: string[] }) {
  const router = useRouter();
  const key = jobIds.join(",");
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const ids = key.split(",");
    const loop = async () => {
      if (stop) return;
      let finished = false;
      for (const id of ids) {
        try {
          const res = await fetch(`/api/songs/${encodeURIComponent(id)}`, { cache: "no-store" });
          if (res.ok) {
            const j = (await res.json()) as { status: string };
            if (j.status === "completed" || j.status === "failed") finished = true;
          }
        } catch {
          /* retry next round */
        }
      }
      if (finished) { router.refresh(); return; }
      timer = setTimeout(loop, 4000);
    };
    void loop();
    return () => { stop = true; clearTimeout(timer); };
  }, [key, router]);
  return null;
}
