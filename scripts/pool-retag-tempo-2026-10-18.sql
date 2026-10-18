-- Retag: tempo_band 'fast' -> 'medium' on 18 vocal tracks the energy judge rated 'low' (2026-10-18 audit, station mood sequencing).
-- The tempo tag feeds the "fast" tag that ranking and the untagged-energy fallback read; on slow classical, ghazal-like and
-- devotional rows it contradicted the energy and daypart tags. Data-only, reversible; run on S's tap, not by migration.
-- Revert: update pool_tracks set tempo_band = 'fast' where id in (<same ids>);
update pool_tracks set tempo_band = 'medium'
where status = 'admitted' and kind = 'vocal' and energy = 'low' and tempo_band = 'fast' and id in (
  '3e565751-78e9-42b3-ae91-50d7106c3085',  -- hi ballad
  'ab3af658-e702-423f-92f1-cbba10ae42c6',  -- hi classical
  '65791043-b361-4a06-85b4-43fefd71631c',  -- hi classical
  '4e29cd82-c2b5-4b22-a6f5-f7afd2ca194a',  -- hi classical
  'e99c7a88-962c-4f2d-a755-21517ee5e49d',  -- hi classical
  'ed0cb4bb-8be5-4ea9-bb88-e6bf0bf3ff56',  -- hi devotional
  '0f6c8258-2660-41b5-9ce0-c535d3e4e897',  -- hi hindi-pop
  '686d0f4d-c65f-4b6e-aaed-3bf77ff6a9fd',  -- kn folk
  '91459179-0deb-4714-ba0a-e8a13e667417',  -- kn light-classical
  '70325c2b-f7e5-40db-899c-feb9447a68cf',  -- kn light-classical
  '909f0095-5906-49b6-8d35-2cfb7068d4f7',  -- ta classical
  '0a247d60-7730-450f-a33a-36560536eb65',  -- ta classical
  '3c233571-0c16-4f8a-bda4-3820ca44aedb',  -- ta classical
  'c86f9780-9042-4dc5-bcfb-8c424fe74e66',  -- ta devotional
  '420836c3-8893-42c5-9ea4-214518e3f17e',  -- ta folk
  'a6ad1299-c16c-40a6-894d-0ebc69574ef1',  -- ta folk
  '26a723fd-95ae-4858-bf96-fe2077c672c8',  -- te keerthana
  '81dcd1ec-b03e-4f31-b011-39938934cff7'  -- te None
);
