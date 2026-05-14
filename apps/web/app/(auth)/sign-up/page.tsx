import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (data?.user) redirect("/library");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight">Create account</h1>
        <p className="text-sm text-foreground/60">
          Free tier: 3 songs per month. Upgrade later via Stripe (not in v1).
        </p>
      </header>
      <SignUpForm />
      <footer className="text-sm text-foreground/60">
        Already signed up?{" "}
        <Link className="underline" href="/sign-in">
          Sign in
        </Link>
        .
      </footer>
    </main>
  );
}
