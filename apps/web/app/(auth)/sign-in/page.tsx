import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string; error_description?: string };
}) {
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (data?.user) {
    redirect(searchParams?.next ?? "/library");
  }

  // /auth/callback bounces here with `error_description` when the code
  // exchange fails (expired link, already-used link, mismatched
  // browser, etc.). Preferring it over the bare `error` query keeps
  // the user-facing copy useful.
  const initialError =
    searchParams?.error_description ?? searchParams?.error ?? undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight">Sign in</h1>
        <p className="text-sm text-foreground/60">
          Email + password. We don&apos;t store any third-party tokens yet.
        </p>
      </header>
      <SignInForm next={searchParams?.next} initialError={initialError} />
      <footer className="text-sm text-foreground/60">
        No account?{" "}
        <Link className="underline" href="/sign-up">
          Create one
        </Link>
        .
      </footer>
    </main>
  );
}
