# v1.3 Sprint 6 — production smoke

**Target**: https://neo-fm-web.vercel.app
**Smoke user**: e2e-smoke@neo-fm.test
**Date**: 2026-05-17T10:21:38.507Z
**Overall**: GREEN — every surface rendered as expected

| # | Step | Result | Notes |
| --- | --- | --- | --- |
| 1 | `1-landing` | ✅ | url="https://neo-fm-web.vercel.app/" file="01-landing.png" h1="The only AI music platform that gets Indian languages right at the phoneme level." |
| 2 | `2-pricing-anon` | ✅ | url="https://neo-fm-web.vercel.app/pricing" file="02-pricing-anon.png" |
| 3 | `3-discover-anon` | ✅ | url="https://neo-fm-web.vercel.app/discover" file="03-discover-anon.png" |
| 4 | `4-sign-in` | ✅ | url="https://neo-fm-web.vercel.app/library" |
| 5 | `5-library-grid` | ✅ | url="https://neo-fm-web.vercel.app/library" file="05-library-grid.png" |
| 6 | `6-library-list` | ✅ | url="https://neo-fm-web.vercel.app/library?view=list" file="06-library-list.png" |
| 7 | `7-cmd-palette` | ✅ | file="07-cmd-palette.png" |
| 8 | `8-songs-new` | ✅ | url="https://neo-fm-web.vercel.app/songs/new" file="08-songs-new.png" presetsFound=8 |
| 9 | `9-pricing-authed` | ✅ | url="https://neo-fm-web.vercel.app/pricing" file="09-pricing-authed.png" |
| 10 | `10-account` | ✅ | url="https://neo-fm-web.vercel.app/account" file="10-account.png" |
| 11 | `11-song-detail` | ✅ | url="https://neo-fm-web.vercel.app/songs/1130b2cf-6f54-42ea-a544-9976afa6b8e5" file="11-song-detail.png" remixCtaVisible=true |
| 12 | `12-cover-art-panel` | ✅ | file="12-cover-art-panel.png" panelVisible=true |
| 13 | `health-anon` | ✅ | status=200 body={"status":"ok","phase":1,"version":"production","commit":null,"env":"production","checks":{"supabase":{"status":"ok","latencyMs":12},"upstash":{"status":"missing","latencyMs":null}},"timestamp":"2026-05-17T10:21:38.286Z"} |
| 14 | `health` | ✅ | status=200 body={"status":"ok","phase":1,"version":"v1.3-wedge","commit":"e028528","env":"production","checks":{"supabase":{"status":"ok","latencyMs":5},"upstash":{"status":"missing","latencyMs":null}},"timestamp":"2026-05-17T10:21:38.463Z"} |

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
- ![12-cover-art-panel](./12-cover-art-panel.png)
