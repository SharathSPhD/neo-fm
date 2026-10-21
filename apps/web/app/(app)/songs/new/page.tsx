import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ideaById } from "@/lib/ideas/catalog";
import { serverI18n } from "@/lib/i18n/server";
import { betaLanguages, enabledExpansionLanguages } from "@/lib/languages/registry";
import { hasStationPass } from "@/lib/billing/pass";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { UserTier } from "@/lib/agent/tiers";
import { englishMainEnabled } from "@/lib/languages/english-main";
import { tasteBriefEnabled } from "@/lib/taste/brief";
import { gradeLeft, lyricGradesEnabled, readGradeBalance } from "@/lib/lyrics/grade";
import { type VoiceChoice, voiceChoiceEnabled, voiceEntitlement } from "@/lib/voice";

import { CreationCanvas } from "./creation-canvas";

export default async function NewSongPage(props: { searchParams?: Promise<{ idea?: string }> }) {
  const searchParams = await props.searchParams;
  const { t } = await serverI18n();
  // `?idea=<id>` comes from the /ideas gallery. Only known catalog ids are honoured; the prompt text never travels in the URL.
  const idea = ideaById(searchParams?.idea);
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect(idea ? `/sign-in?next=${encodeURIComponent(`/songs/new?idea=${idea.id}`)}` : "/sign-in?next=/songs/new");

  // First-run guide shows until the user has at least one song. A failed
  // count must not hide the form, so errors fall back to "show the guide".
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  const firstRun = (count ?? 0) === 0;

  // Voice choice (VOICE_CHOICE=1): the picker offers what the listener's tier and pass include; Free sees "Auto" only.
  let voiceChoices: readonly VoiceChoice[] | undefined;
  if (voiceChoiceEnabled()) {
    const { data: row } = await supabase.from("users").select("tier").eq("id", data.user.id).maybeSingle();
    const pass = await hasStationPass(createServiceRoleClient(), data.user.id);
    voiceChoices = voiceEntitlement((row as { tier?: UserTier } | null)?.tier, pass).choices;
  }

  // LYRIC_GRADES=1: the picker offers Premium/Studio only while a credit (monthly allowance or add-on) is left.
  let lyricGrades: { premium: number; studio: number } | undefined;
  if (lyricGradesEnabled()) {
    const db = createServiceRoleClient();
    const { data: row } = await db.from("users").select("tier").eq("id", data.user.id).maybeSingle();
    const tier = ((row as { tier?: UserTier } | null)?.tier ?? "free") as UserTier;
    const bal = await readGradeBalance(db, data.user.id);
    lyricGrades = { premium: gradeLeft(tier, "premium", bal).total, studio: gradeLeft(tier, "studio", bal).total };
  }

  // Every expansion language is labelled beta until a native read passes and its code is listed in LANG_REVIEWED.
  const expansion = enabledExpansionLanguages(process.env.LANG_WAVES);
  const beta = new Set(betaLanguages(expansion.map((l) => l.code), process.env.LANG_REVIEWED));
  const extraLanguages = expansion.map(({ code, name }) => ({ code, name: beta.has(code) ? `${name} (beta)` : name }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Breadcrumbs
        items={[{ href: "/library", label: t("nav.library") }, { label: t("nav.newSong") }]}
      />
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-medium tracking-tight">{t("nav.newSong")}</h1>
        <p className="text-sm text-foreground/60">
          {t("create.intro")}
        </p>
        <Link href="/gift" className="text-sm text-accent underline">
          {t("gift.cta")}
        </Link>
      </header>
      <CreationCanvas tasteBrief={tasteBriefEnabled()} englishMain={englishMainEnabled()} voiceChoices={voiceChoices} lyricGrades={lyricGrades} firstRun={firstRun} extraLanguages={extraLanguages} initialIdea={idea ? { prompt: idea.text, language: idea.lang } : undefined} />
    </div>
  );
}
