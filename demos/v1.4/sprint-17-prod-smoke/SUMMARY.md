# v1.4 Sprint 17 — production smoke

**Target**: https://neo-fm-web.vercel.app
**Smoke user**: e2e-smoke@neo-fm.test
**Date**: 2026-05-17T21:22:36.158Z
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
| 8 | `8-songs-new` | ✅ | url="https://neo-fm-web.vercel.app/songs/new" file="08-songs-new.png" presetsFound=11 |
| 9 | `9-pricing-authed` | ✅ | url="https://neo-fm-web.vercel.app/pricing" file="09-pricing-authed.png" |
| 10 | `10-account` | ✅ | url="https://neo-fm-web.vercel.app/account" file="10-account.png" |
| 11 | `11-song-detail` | ✅ | url="https://neo-fm-web.vercel.app/songs/1130b2cf-6f54-42ea-a544-9976afa6b8e5" file="11-song-detail.png" remixCtaVisible=true |
| 12 | `12-cover-art-panel` | ✅ | file="12-cover-art-panel.png" panelVisible=true |
| 13 | `13-voice-picker` | ✅ | file="13-voice-picker.png" rowCount=17 |
| 14 | `14-advanced-disclosure` | ✅ | file="14-advanced-disclosure.png" |
| 15 | `15-preset-chip-count` | ✅ | presetCount=11 |
| 16 | `16-discover-sanskrit` | ✅ | file="16-discover-sanskrit.png" cardCount=0 audioReady=true |
| 17 | `17-discover-bengali` | ✅ | file="17-discover-bengali.png" cardCount=0 audioReady=true |
| 18 | `18-discover-telugu` | ✅ | file="18-discover-telugu.png" cardCount=0 audioReady=true |
| 19 | `19-public-song-page` | ✅ | url="https://neo-fm-web.vercel.app/s/0nxwv98vyt" file="19-public-song.png" |
| 20 | `20-variation-dialog` | ✅ | file="20-variation-dialog.png" dialogOpen=true |
| 21 | `21-compare-page` | ✅ | url="https://neo-fm-web.vercel.app/songs/1130b2cf-6f54-42ea-a544-9976afa6b8e5/compare" file="21-compare-page.png" audioCount=0 |
| 22 | `22-batch-publish-bar` | ✅ | file="22-batch-publish-bar.png" checkable=false barVisible=false |
| 23 | `health-anon` | ✅ | status=200 body={"status":"ok","phase":1,"version":"production","commit":null,"env":"production","checks":{"supabase":{"status":"ok","latencyMs":10},"upstash":{"status":"missing","latencyMs":null}},"timestamp":"2026-05-17T21:22:33.025Z"} |
| 24 | `health` | ✅ | status=200 body={"status":"ok","phase":1,"version":"v1.3-wedge","commit":"c631cc0","env":"production","checks":{"supabase":{"status":"ok","latencyMs":6},"upstash":{"status":"missing","latencyMs":null}},"timestamp":"2026-05-17T21:22:33.276Z"} |
| 25 | `24a-buckets-exist` | ✅ | results={"cover-art":400,"voice-samples":400,"tracks":400} |
| 26 | `24b-voice-previews` | ✅ | results={"indic_hi_male_broadcast":200,"indic_hi_female_lyrical":200,"indic_kn_female_bhajan":200} |
| 27 | `25-public-audio-url` | ✅ | publicId="0nxwv98vyt" status=200 |

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
- ![13-voice-picker](./13-voice-picker.png)
- ![14-advanced-disclosure](./14-advanced-disclosure.png)
- ![16-discover-sanskrit](./16-discover-sanskrit.png)
- ![17-discover-bengali](./17-discover-bengali.png)
- ![18-discover-telugu](./18-discover-telugu.png)
- ![19-public-song-page](./19-public-song.png)
- ![20-variation-dialog](./20-variation-dialog.png)
- ![21-compare-page](./21-compare-page.png)
- ![22-batch-publish-bar](./22-batch-publish-bar.png)
