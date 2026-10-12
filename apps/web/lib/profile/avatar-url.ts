/** Public URL of an avatar in the public `avatars` bucket, or null when the user has none. */
export function avatarUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/avatars/${path}`;
}
