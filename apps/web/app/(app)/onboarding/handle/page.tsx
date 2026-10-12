/**
 * /onboarding/handle -- handle picker (Sprint G).
 *
 * Shown after first sign-in (linked from the UserMenu when
 * `handle is null`) and from the profile page when an existing
 * user wants to change their handle. The page itself is server-
 * rendered to redirect signed-out visitors; the form lives in a
 * client island.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { createServerClient } from "@/lib/supabase/server";

import { HandleForm } from "./handle-form";
import { serverI18n } from "@/lib/i18n/server";

export function generateMetadata(): Metadata {
  const { t } = serverI18n();
  return {
    title: t("handle.meta.title"),
    description: t("handle.meta.description"),
  };
}

export const dynamic = "force-dynamic";

export default async function OnboardingHandlePage() {
  const { t } = serverI18n();
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/sign-in?next=/onboarding/handle");

  const { data: row } = await supabase
    .from("users")
    .select("handle")
    .eq("id", auth.user.id)
    .maybeSingle();

  const current =
    (row as unknown as { handle?: string | null } | null)?.handle ?? null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          {t("handle.eyebrow")}
        </p>
        <h1 className="text-3xl font-medium tracking-tight">
          {current ? t("handle.title.change") : t("handle.title.pick")}
        </h1>
        <p className="text-sm text-foreground/60">
          {t("handle.intro.before")}{" "}
          <code>/u/yourhandle</code> {t("handle.intro.after")}
        </p>
      </header>
      <HandleForm initial={current ?? ""} />
    </div>
  );
}
