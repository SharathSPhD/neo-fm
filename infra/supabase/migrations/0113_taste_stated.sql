-- Stated taste: what the listener tells us about their taste (genres, moods, instruments, eras, register, background),
-- as the structured brief of apps/web/lib/taste/brief.ts (v1). Lives next to the derived weights of 0057 on the same row.
-- Written only by /api/me/taste/stated (service role, behind the 'personalize' consent and TASTE_BRIEF=1); the user
-- already has select and delete on the row (0057/0083). No new grants. The web code degrades gracefully while the column
-- is absent. Idempotent.

alter table public.taste_profiles add column if not exists stated jsonb;
