/**
 * The language pages live outside the (marketing) route group on purpose: that group has a route-level
 * loading boundary, which streams the shell (HTTP 200) before the page can call notFound(). Here an
 * unknown slug gets a real 404. The nav is the same one the group uses.
 */
import MarketingLayout from "../(marketing)/layout";

export default function AiSongsLayout({ children }: { children: React.ReactNode }) {
  return <MarketingLayout>{children}</MarketingLayout>;
}
