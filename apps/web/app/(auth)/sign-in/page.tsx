import Link from "next/link";
import { redirect } from "next/navigation";

import { safeNext } from "@/lib/auth/safe-next";
import { createServerClient } from "@/lib/supabase/server";

import { BrandMark } from "@/components/brand-mark";
import { SignInForm } from "./sign-in-form";
import { serverI18n } from "@/lib/i18n/server";

export default async function SignInPage(
  props: {
    searchParams?: Promise<{ next?: string; error?: string; error_description?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const { t } = await serverI18n();
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (data?.user) {
    redirect(safeNext(searchParams?.next));
  }

  // /auth/callback bounces here with `error_description` when the code
  // exchange fails (expired link, already-used link, mismatched
  // browser, etc.). Preferring it over the bare `error` query keeps
  // the user-facing copy useful.
  const initialError =
    searchParams?.error_description ?? searchParams?.error ?? undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <BrandMark />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight">{t("auth.signIn.title")}</h1>
        <p className="text-sm text-foreground/60">
          {t("auth.signIn.subtitle")}
        </p>
      </header>
      <div className="glass rounded-3xl p-6">
        <SignInForm next={safeNext(searchParams?.next)} initialError={initialError} />
      </div>
      <footer className="text-sm text-foreground/60">
        {t("auth.signIn.noAccount")}{" "}
        <Link className="underline" href="/sign-up">
          {t("auth.signIn.createOne")}
        </Link>
        .
      </footer>
    </main>
  );
}
