/**
 * Marketing route-group layout. Anonymous-friendly; reads the session
 * server-side so the nav can swap "Sign in / Get started" for
 * "Open app →" when the visitor is already authenticated.
 */
import { createServerClient } from "@/lib/supabase/server";
import { MarketingNav } from "@/components/marketing-nav";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  const isSignedIn = Boolean(data?.user);
  return (
    <>
      <MarketingNav isSignedIn={isSignedIn} />
      {children}
    </>
  );
}
