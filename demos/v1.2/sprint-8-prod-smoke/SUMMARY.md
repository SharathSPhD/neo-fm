# Sprint 8 — production smoke

**Target**: https://neo-fm-web.vercel.app
**Smoke user**: e2e-smoke@neo-fm.test
**Date**: 2026-05-16T17:56:12.178Z
**Overall**: GREEN — every surface rendered as expected

| # | Step | Result | Notes |
| --- | --- | --- | --- |
| 1 | `1-landing` | ✅ | url="https://neo-fm-web.vercel.app/" file="01-landing.png" |
| 2 | `2-pricing-anon` | ✅ | url="https://neo-fm-web.vercel.app/pricing" file="02-pricing-anon.png" |
| 3 | `3-discover-anon` | ✅ | url="https://neo-fm-web.vercel.app/discover" file="03-discover-anon.png" |
| 4 | `4-sign-in` | ✅ | url="https://neo-fm-web.vercel.app/library" |
| 5 | `5-library-grid` | ✅ | url="https://neo-fm-web.vercel.app/library" file="05-library-grid.png" |
| 6 | `6-library-list` | ✅ | url="https://neo-fm-web.vercel.app/library?view=list" file="06-library-list.png" |
| 7 | `7-cmd-palette` | ✅ | file="07-cmd-palette.png" |
| 8 | `8-songs-new` | ✅ | url="https://neo-fm-web.vercel.app/songs/new" file="08-songs-new.png" |
| 9 | `9-pricing-authed` | ✅ | url="https://neo-fm-web.vercel.app/pricing" file="09-pricing-authed.png" |
| 10 | `10-account` | ✅ | url="https://neo-fm-web.vercel.app/account" file="10-account.png" |
| 11 | `11-song-detail` | ✅ | url="https://neo-fm-web.vercel.app/songs/96d58383-0f30-41c9-ad81-745efd29b0be" file="11-song-detail.png" remixCtaVisible=true |
| 12 | `health` | ✅ | status=200 body={"status":"ok","phase":1,"version":"v1.1-deep-dive","commit":"df80359","env":"production","checks":{"supabase":{"status":"ok","latencyMs":12},"upstash":{"status":"missing","latencyMs":null}},"timestamp":"2026-05-16T17:56:12.138Z"} |

## Screenshots

- ![1-landing](./01-landing.png)
- ![2-pricing-anon](./02-pricing-anon.png)
- ![3-discover-anon](./03-discover-anon.png)
- ![5-library-grid](./05-library-grid.png)
- ![6-library-list](./06-library-list.png)
- ![7-cmd-palette](./07-cmd-palette.png)
- ![8-songs-new](./08-songs-new.png)
- ![9-pricing-authed](./09-pricing-authed.png)
- ![10-account](./10-account.png)
- ![11-song-detail](./11-song-detail.png)
