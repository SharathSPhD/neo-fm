import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

import { GoogleButton } from "../google-button";
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
          Start free: a few songs every month. Upgrade any time for longer, custom lyrics and music.
        </p>
      </header>
      <GoogleButton />
      <SignUpForm />
      <p className="text-xs text-foreground/60">
        By creating an account you confirm you are 18 or older and accept our{" "}
        <Link className="underline" href="/terms">Terms</Link> and{" "}
        <Link className="underline" href="/privacy">Privacy notice</Link>, which explain what we collect, why, who processes it,
        and your rights. Questions: grievance@neo-fm.com.
      </p>
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
