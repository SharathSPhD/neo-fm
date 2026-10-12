import { notFound } from "next/navigation";

import { MiniPlayer } from "@/components/player/mini-player";
import { PlayerProvider } from "@/components/player/player-provider";

// Intentional dev-only harness (see docs/DEV-PREVIEW.md); 404s in production.
// Mirrors the authed layout's player wiring so persistence across client
// navigations can be tested without a Supabase session. Dev only.
export default function DevPreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PlayerProvider>
      {children}
      <MiniPlayer />
    </PlayerProvider>
  );
}
