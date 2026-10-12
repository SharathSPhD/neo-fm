/** /whats-new -- plain-language release notes, localized with an English fallback. */
import type { Metadata } from "next";

import { WhatsNewList } from "@/components/whats-new-list";

export const metadata: Metadata = {
  title: "What's new -- neo-fm",
  description: "Everything new in neo-fm, in plain words.",
};

export default function WhatsNewPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <WhatsNewList />
    </main>
  );
}
