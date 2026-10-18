import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { occasionById } from "@/lib/gift/occasions";
import { serverI18n } from "@/lib/i18n/server";
import { createServerClient } from "@/lib/supabase/server";

import { GiftWizard } from "./gift-wizard";

export default async function GiftPage(props: { searchParams?: Promise<{ occasion?: string }> }) {
  const searchParams = await props.searchParams;
  const { t } = await serverI18n();
  // `?occasion=<id>` lets a festival campaign link straight to a preselected occasion; unknown ids fall back to Diwali.
  const occasion = occasionById(searchParams?.occasion)?.id ?? "diwali";
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect(`/sign-in?next=${encodeURIComponent(`/gift?occasion=${occasion}`)}`);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Breadcrumbs items={[{ href: "/library", label: t("nav.library") }, { label: t("gift.title") }]} />
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-medium tracking-tight">{t("gift.title")}</h1>
        <p className="text-sm text-foreground/60">{t("gift.intro")}</p>
      </header>
      <GiftWizard initialOccasion={occasion} />
    </div>
  );
}
