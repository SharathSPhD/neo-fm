/**
 * Public layout for /station: the station is open to signed-out visitors (shared pool, no per-listener signals).
 * Signed-in listeners get the same shell as `(app)/layout.tsx`; visitors get the marketing nav. PlayerProvider wraps
 * both because the station player pauses the app-wide player before it starts.
 */
import { AppShell } from "@/components/app-shell";
import { MarketingNav } from "@/components/marketing-nav";
import { NetworkBanner } from "@/components/network-banner";
import { MiniPlayer } from "@/components/player/mini-player";
import { PlayerProvider } from "@/components/player/player-provider";
import { ReferralClaim } from "@/components/referral";
import { fetchShellUser } from "@/lib/supabase/shell-user";

export default async function StationGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await fetchShellUser();
  if (!user) {
    return (
      <PlayerProvider>
        <MarketingNav isSignedIn={false} />
        {children}
      </PlayerProvider>
    );
  }
  return (
    <PlayerProvider>
      <NetworkBanner />
      <ReferralClaim />
      <AppShell user={user}>
        {children}
      </AppShell>
      <MiniPlayer />
    </PlayerProvider>
  );
}
