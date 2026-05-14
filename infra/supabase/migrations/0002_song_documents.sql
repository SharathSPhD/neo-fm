-- 0002_song_documents.sql -- the canonical Song Document store
--
-- song_documents stores the full Zod-validated Song Document JSON keyed by
-- (id, user_id). It is immutable after insert: there are no UPDATE policies
-- on the table for authenticated users (see 0005_rls.sql), so any "edit" is
-- a new row.

create table if not exists public.song_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  language public.language_enum not null,
  style_family public.style_family_enum not null,
  document_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists song_documents_user_id_created_idx
  on public.song_documents (user_id, created_at desc);

comment on column public.song_documents.document_json is
  'Full Song Document, Zod-validated by the cloud API before insert. Schema source of truth: packages/song-doc/schema.json. The DB does not enforce a JSON schema check because the schema evolves faster than migrations; the cloud API guarantees the shape on insert.';
