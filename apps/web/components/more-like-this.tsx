import Link from "next/link";

import {
  hasPersonalizationConsent,
  loadTaste,
} from "@/lib/personalization/load";
import { rankSimilar, type SimilarCandidate } from "@/lib/personalization/similar";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";
import { createServerClient } from "@/lib/supabase/server";

type Row = {
  public_id: string;
  song_documents: {
    title: string | null;
    language: string;
    style_family: string;
  } | null;
};

/**
 * "More like this" under a public song. Public songs only, so private
 * work never leaks; taste weights reorder results only for a signed-in
 * listener who opted in. Renders nothing on any failure.
 */
export async function MoreLikeThis({
  publicId,
  language,
  style,
}: {
  publicId: string;
  language: string;
  style: string;
}) {
  // style/language come from stored documents and are interpolated into a
  // PostgREST .or() filter below, so only plain slugs are allowed through.
  const SLUG = /^[a-z0-9_-]{1,40}$/;
  if (!SLUG.test(style) || !SLUG.test(language)) return null;
  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from("jobs")
      .select(
        "public_id, song_documents!inner ( title, language, style_family ), tracks!inner ( id )",
      )
      .eq("status", "completed")
      .eq("published_visibility", "public")
      .not("public_id", "is", null)
      .neq("public_id", publicId)
      .or(
        `style_family.eq.${style},language.eq.${language}`,
        { referencedTable: "song_documents" },
      )
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(60)
      .returns<Row[]>();
    const candidates: SimilarCandidate[] = (data ?? []).flatMap((r) =>
      r.song_documents
        ? [
            {
              public_id: r.public_id,
              title: r.song_documents.title,
              language: r.song_documents.language,
              style: r.song_documents.style_family,
            },
          ]
        : [],
    );

    let profile = null;
    let personalised = false;
    const { data: u } = await supabase.auth.getUser();
    const userId = u?.user?.id;
    if (userId && (await hasPersonalizationConsent(supabase, userId))) {
      const t = await loadTaste(supabase, userId);
      if (t.profile.nSignals >= 3) {
        profile = t.profile;
        personalised = true;
      }
    }

    const picks = rankSimilar(
      { public_id: publicId, language, style },
      candidates,
      profile,
    );
    if (picks.length === 0) return null;
    return (
      <section aria-labelledby="mlt-heading" className="flex flex-col gap-3">
        <h2 id="mlt-heading" className="text-lg font-medium">
          More like this
        </h2>
        {personalised ? (
          <p className="text-xs text-foreground/50">
            Ordered with your listening taste.{" "}
            <Link href="/account" className="underline">
              Manage in Account
            </Link>
          </p>
        ) : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {picks.map((p) => (
            <li key={p.public_id}>
              <Link
                href={`/s/${p.public_id}`}
                className="block rounded-lg border border-muted/20 bg-muted/5 p-4 hover:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <span className="font-medium">{p.title || "Untitled"}</span>
                <span className="mt-1 block text-xs text-foreground/60">
                  {prettyLanguage(p.language)} · {prettyStyle(p.style)}
                </span>
                <span className="mt-1 block text-[11px] text-accent/80">
                  {p.reason}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  } catch {
    return null;
  }
}
