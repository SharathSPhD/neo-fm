import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { JobProgress } from "@/components/job-progress";
import { occasionById } from "@/lib/gift/occasions";
import { serverI18n } from "@/lib/i18n/server";
import { SongIdSchema } from "@/lib/api/song-schemas";
import { createServerClient } from "@/lib/supabase/server";

import { GiftShare } from "./gift-share";

export const dynamic = "force-dynamic";

interface GiftJob {
  id: string;
  status: string;
  created_at: string;
  public_id: string | null;
  published_visibility: "public" | "unlisted" | "private" | null;
  dedication_to: string | null;
}

export default async function GiftStatusPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ occasion?: string; ded?: string }>;
}) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const { t, lang } = await serverI18n();
  if (!SongIdSchema.safeParse(id).success) notFound();

  const supabase = createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect(`/sign-in?next=${encodeURIComponent(`/gift/${id}`)}`);

  const { data } = await supabase
    .from("jobs")
    .select("id, status, created_at, public_id, published_visibility, dedication_to")
    .eq("id", id)
    .maybeSingle<GiftJob>();
  if (!data) notFound();

  const occasion = occasionById(searchParams?.occasion);
  const occasionLabel = occasion?.label[lang] ?? t("gift.title");
  const to = data.dedication_to;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Breadcrumbs items={[{ href: "/gift", label: t("gift.title") }, { label: to ?? occasionLabel }]} />
      {data.status === "completed" ? (
        <GiftShare
          songId={data.id}
          to={to ?? ""}
          occasionLabel={occasionLabel}
          initialPublicId={data.published_visibility && data.published_visibility !== "private" ? data.public_id : null}
          dedicationFailed={searchParams?.ded === "failed"}
        />
      ) : data.status === "failed" ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-red-300">{t("gift.failed")}</p>
          <Link href="/gift" className="text-sm text-accent underline">{t("gift.tryAgain")}</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-medium tracking-tight">{t("gift.making")}</h1>
          <JobProgress songId={data.id} createdAt={data.created_at} initialStage={data.status === "processing" ? "starting" : "queued"} />
        </div>
      )}
    </div>
  );
}
