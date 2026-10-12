import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { T } from "@/components/t";

import { PreviewClient } from "./preview-client";

/**
 * Dev-only harness that renders the first-run guide, synced lyrics, and
 * empty state without needing a Supabase session, so Playwright can take
 * mobile screenshots and run axe in CI/local. 404s in any production build.
 */
export default function DevPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-6">
      <h1 className="text-2xl font-medium">UI preview</h1>
      <Link href="/dev-preview/other" className="text-accent underline">Go to another page</Link>
      <PreviewClient />
      <EmptyState
        title={<T k="empty.title" />}
        body={<T k="empty.body" />}
        cta={{ href: "/songs/new", label: <T k="empty.cta" /> }}
      />
    </main>
  );
}
