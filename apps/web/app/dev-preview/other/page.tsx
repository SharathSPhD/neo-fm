import Link from "next/link";

export default function OtherPreviewPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-medium">Another page</h1>
      <Link href="/dev-preview" className="text-accent underline">Back to preview</Link>
    </main>
  );
}
