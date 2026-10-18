-- 0099_ad_slots.sql
-- DRAFT, NOT APPLIED. House-ad / sponsor slot system for the station queue (ads desk spec A1; issue #212). Needs S to name it before prod apply.
-- Degrades gracefully: the queue route treats a missing table as "no ads", and nothing is served unless ADS_ENABLED=1.
-- Change from the desk draft: cta_url may also be a path on our own site (/pricing, /gift) for house ads; sponsors still need https.

create table if not exists public.ad_slots (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('house', 'sponsor')),
  sponsor_name text,                         -- null for house ads
  category text not null default 'house',    -- checked against the blocklist at intake
  headline text not null,
  cta_label text,
  cta_url text,                              -- https only, enforced below
  audio_path text,                           -- storage path in 'tracks' bucket; null = card-only
  image_path text,
  duration_seconds int check (duration_seconds is null or duration_seconds between 5 and 30),
  languages text[] not null default '{}',    -- empty = any language
  dayparts text[] not null default '{}',     -- empty = any daypart
  excluded_tags text[] not null default '{}',-- never play next to tracks carrying these tags (e.g. devotional)
  ai_made boolean not null default false,    -- true if any AI voice/jingle is in the creative -> label required
  weight int not null default 1 check (weight between 1 and 100),
  start_at timestamptz,
  end_at timestamptz,
  active boolean not null default false,     -- off until reviewed
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ad_slots_cta_safe check (cta_url is null or cta_url like 'https://%' or (kind = 'house' and cta_url ~ '^/[^/]')),
  constraint ad_slots_sponsor_named check (kind = 'house' or sponsor_name is not null)
);

create table if not exists public.ad_events (
  id bigint generated always as identity primary key,
  slot_id uuid not null references public.ad_slots(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,  -- null for signed-out listeners
  event text not null check (event in ('start', 'complete', 'tap')),
  created_at timestamptz not null default now()
);

create index if not exists ad_events_slot_created_idx on public.ad_events (slot_id, created_at desc);
create index if not exists ad_events_user_created_idx on public.ad_events (user_id, created_at desc) where user_id is not null;

alter table public.ad_slots enable row level security;
alter table public.ad_events enable row level security;
revoke all on public.ad_slots, public.ad_events from public, anon, authenticated;
-- No policies: both tables are service-role only (queue route and ad-event route use the admin client).

comment on table public.ad_slots is 'House ads and sponsor spots. Service role only. Ads are never served to paid tiers (enforced in lib/station/ads.ts).';
comment on table public.ad_events is 'Ad start/complete/tap log for sponsor reporting and the frequency cap. No taste signal is derived from it.';

-- Seed house ads: gift-a-song and Station pass, card-only (no audio, no new spend), one per supported language.
-- Inactive and unreviewed on purpose: a human sets reviewed_by / reviewed_at and active = true after reading the copy.
-- The Indic copy needs a native-speaker read first. The Station pass promo must stay off until the pass is on sale
-- (it is test-mode only today and has no entitlement yet).
insert into public.ad_slots (kind, category, headline, cta_label, cta_url, languages, ai_made, weight, active)
select 'house', 'house', v.headline, v.cta, v.url, array[v.lang], false, 1, false
from (values
    ('en', 'Send someone a song made just for them.', 'Gift a song', '/gift'),
    ('hi', 'उनके लिए खास बना एक गाना भेजिए।', 'गाना गिफ्ट करें', '/gift'),
    ('ta', 'அவர்களுக்காகவே உருவாக்கிய பாடலை அனுப்புங்கள்.', 'பாடலை பரிசளிக்கவும்', '/gift'),
    ('te', 'వారి కోసమే రూపొందించిన పాటను పంపండి.', 'పాటను బహుమతిగా ఇవ్వండి', '/gift'),
    ('kn', 'ಅವರಿಗಾಗಿಯೇ ಮಾಡಿದ ಹಾಡನ್ನು ಕಳುಹಿಸಿ.', 'ಹಾಡನ್ನು ಉಡುಗೊರೆಯಾಗಿ ನೀಡಿ', '/gift'),
    ('bn', 'ওদের জন্যই তৈরি একটি গান পাঠান।', 'গান উপহার দিন', '/gift'),
    ('en', 'Hear the station without breaks. ₹149 a month.', 'See the pass', '/pricing'),
    ('hi', 'बिना ब्रेक के सुनिए। ₹149 प्रति माह।', 'पास देखें', '/pricing'),
    ('ta', 'இடைவேளை இல்லாமல் கேளுங்கள். மாதம் ₹149.', 'பாஸைப் பாருங்கள்', '/pricing'),
    ('te', 'విరామాలు లేకుండా వినండి. నెలకు ₹149.', 'పాస్ చూడండి', '/pricing'),
    ('kn', 'ವಿರಾಮವಿಲ್ಲದೆ ಕೇಳಿ. ತಿಂಗಳಿಗೆ ₹149.', 'ಪಾಸ್ ನೋಡಿ', '/pricing'),
    ('bn', 'বিরতি ছাড়া শুনুন। মাসে ₹149।', 'পাস দেখুন', '/pricing')) as v(lang, headline, cta, url)
where not exists (select 1 from public.ad_slots s where s.kind = 'house' and s.headline = v.headline);
