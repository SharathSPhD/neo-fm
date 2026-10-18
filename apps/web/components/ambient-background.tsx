"use client";

import { useEffect, useState } from "react";

import { type UiDaypart, uiDaypart } from "@/lib/ui/daypart";

/**
 * Fixed, decorative aurora behind the page. Server-renders as "night" (the
 * default dark look) and switches to the listener's local daypart after
 * mount, so there is no hydration mismatch. Re-checks every 10 minutes for
 * tabs left open across a daypart boundary.
 */
export function AmbientBackground() {
  const [part, setPart] = useState<UiDaypart>("night");
  useEffect(() => {
    const tick = () => setPart(uiDaypart(new Date().getHours()));
    tick();
    const id = window.setInterval(tick, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div aria-hidden className="ambient" data-daypart={part}>
      <span />
      <span />
      <span />
    </div>
  );
}
