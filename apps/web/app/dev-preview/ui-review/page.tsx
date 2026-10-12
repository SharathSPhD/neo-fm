import { ReviewClient } from "@/app/ui-review/[token]/review-client";
import { buildSections } from "@/lib/ui-review/core";

// Dev-only: renders the reviewer UI without a database. Saves go to a mocked endpoint in the Playwright spec.
export default function UiReviewPreview() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Kannada translation review (preview)</h1>
      <ReviewClient token="preview-token" lang="kn" sections={buildSections("kn")} initial={{}} />
    </main>
  );
}
