import Link from "next/link";
import { redirect } from "next/navigation";

import { FunnelBeacon } from "@/components/funnel-beacon";
import { createServerClient } from "@/lib/supabase/server";

import { GoogleButton } from "../google-button";
import { BrandMark } from "@/components/brand-mark";
import { SignUpForm } from "./sign-up-form";
import { serverI18n } from "@/lib/i18n/server";

export default async function SignUpPage() {
  const { t } = await serverI18n();
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (data?.user) redirect("/library");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <FunnelBeacon event="signup_view" />
      <BrandMark />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight">{t("auth.signUp.title")}</h1>
        <p className="text-sm text-foreground/60">
          {t("auth.signUp.subtitle")}
        </p>
      </header>
      <p className="text-xs text-foreground/60">
        {t("auth.signUp.ageNotice")}{" "}
        <Link className="underline" href="/terms">
          {t("footer.terms")}
        </Link>
      </p>
      <GoogleButton />
      <div className="glass rounded-3xl p-6">
        <SignUpForm />
      </div>
      <footer className="text-sm text-foreground/60">
        {t("auth.signUp.haveAccount")}{" "}
        <Link className="underline" href="/sign-in">
          {t("auth.signIn.title")}
        </Link>
        .
      </footer>
    </main>
  );
}
