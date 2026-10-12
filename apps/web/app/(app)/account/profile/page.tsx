/** /account/profile -- edit the public bio and profile picture. */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { avatarUrl } from "@/lib/profile/avatar-url";
import { createServerClient } from "@/lib/supabase/server";

import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Edit profile -- neo-fm", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function EditProfilePage() {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/sign-in?next=/account/profile");

  const { data: row } = await supabase
    .from("users")
    .select("handle, bio, avatar_path" as never)
    .eq("id", auth.user.id)
    .maybeSingle<{ handle: string | null; bio: string | null; avatar_path: string | null }>();

  if (!row?.handle) redirect("/onboarding/handle");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight">Edit profile</h1>
        <p className="text-sm text-foreground/60">
          This is what people see on{" "}
          <Link href={`/u/${row.handle}`} className="underline">
            /u/{row.handle}
          </Link>
          .
        </p>
      </header>
      <ProfileForm handle={row.handle} initialBio={row.bio ?? ""} initialAvatarUrl={avatarUrl(row.avatar_path)} />
    </div>
  );
}
