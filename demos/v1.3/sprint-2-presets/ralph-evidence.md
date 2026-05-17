## Ralph evidence — Sprint 2 (preset split)

### (a) Postgres enums (post-migration)
```
$ supabase mcp execute_sql
select t.typname, e.enumlabel
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typname in ('style_family_enum','language_enum')
order by t.typname, e.enumsortorder;

  language_enum     | en
  language_enum     | hi
  language_enum     | kn
  language_enum     | ta            ← new (0033)
  style_family_enum | western
  style_family_enum | carnatic
  style_family_enum | hindustani
  style_family_enum | kannada-folk
  style_family_enum | kannada-light-classical  ← new (0032)
  style_family_enum | tamil-folk               ← new (0032)
```

### (b) get_advisors security (post-migration)

No new ERROR-level lints from Sprint 2. The 11 pre-existing
WARN-level findings (security-definer RPCs, leaked-password)
are inherited from v1.2 and tracked separately.

### (c) Test sweep

| Suite                                       | Result               |
|---------------------------------------------|----------------------|
| @neo-fm/song-doc vitest                     | 18/18                |
| @neo-fm/co-composer vitest                  | 61/61 (+18 new)      |
| @neo-fm/style-presets vitest                | 7/7                  |
| @neo-fm/lyrics vitest                       | 24/24                |
| @neo-fm/web vitest                          | 111/111 (+ 2 cover)  |
| @neo-fm/web typecheck                       | green                |
| @neo-fm/web lint                            | green                |
| @neo-fm/web next build                      | green                |
