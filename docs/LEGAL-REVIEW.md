# Legal and compliance review pack

Prepared 2026-10-13 alongside the rewrite of `/terms`, `/privacy`, the new `/content-policy` and the sign-up notice.
Nothing here is legal advice. It lists what the product does today, what the public pages now say, and what a lawyer
should decide or confirm before anyone relies on it. Page copy lives in `apps/web/app/(marketing)/{terms,privacy,content-policy,trust}/page.tsx`.

## 1. What changed in the product copy

| Where | Change |
|---|---|
| `/terms` | Plain-language summary; new "AI-generated content and ownership", "Public songs, profiles, dedications and collections", "Reports, takedowns and appeals", "Your data", "Changes" sections. |
| `/privacy` | Plain-language summary; DPDP notice structure (who/what/why/consent/processors/retention/rights/children/incidents); reports, dedications, personalisation and anonymous page counts described; Resend added as a processor. |
| `/content-policy` (new) | Allowed/disallowed content, rights rules, what users publish, enforcement, timelines, appeals. Linked from landing footer, terms, privacy, trust. |
| `/trust` | Grievance section links the content policy and the appeal route. |
| Sign-up page | Notice at the point of collection: 18+ confirmation, terms and privacy links, grievance contact. Covers the Google button and the email form. |
| Account page + `/help` | **Corrected a false claim.** They said deleting an account leaves published songs live and anonymous. `DELETE /api/account` actually deletes them (cascade), plus audio, cover art, feedback and the Stripe customer. Copy now matches the code. Export subtitle now reflects the real export contents. |

## 2. Statements that depend on features not yet on `main`

Check these before publishing, or merge the PRs first. Wording was written for the feature as built on each branch.

| Statement | Depends on | State when this was written |
|---|---|---|
| "Anonymous page counts" bullet in `/privacy` (daily totals, no cookie/IP/identifier, honours DNT and GPC) | `claude/funnel-events` (migration 0071, `/api/events`, `FunnelBeacon`) | Not merged. That branch carries the identical sentence at the same spot, so it should merge without conflict; if the PR is dropped, delete the bullet. |
| "If you share a playlist or collection ..." in `/terms`; "collection descriptions" in `/content-policy` | `claude/collections` (migration 0081) | Not merged. Remove if collections do not ship. |
| Listen counts | none found | I found no listen/play-count storage on `main` or any branch. If it ships, privacy needs a line (what is counted, whether tied to an account or listener, retention). |
| Creator profiles (handle, avatar) and dedications | merged (#58, #52) | Described. |
| Takedown, report queue, notice emails | merged (#35) | Described. |
| Rights screening (artists, lyrics, verbatim check) | merged (#65) | Described as best-effort. The verbatim-overlap reference list is empty until entries are added. |

## 3. DPDP Act, 2023 essentials: status

| Requirement | Status |
|---|---|
| Notice before or at collection, itemised, with purpose, rights and complaint route | `/privacy` rewritten; sign-up page now links it. **Gap:** consent is by notice plus the sign-up action, with no unticked checkbox or stored consent record for the core purposes. |
| Consent that is free, specific, informed, withdrawable | Personalisation has a real consent record (`consents` table, version `2026-10`, withdrawal and "forget me"). Other purposes rely on the sign-up notice. Table also allows `improve` and `public_exemplar` purposes: no UI found, confirm they are unused. |
| Grievance redressal and contact | `grievance@neo-fm.com`, 24 h acknowledge, 15 days resolve. **Gap:** no named Grievance Officer or postal address on any page. |
| Rights: access/summary, correction, erasure, nomination | Export and delete are self-serve. Correction, summary beyond the export, and nomination are email-only. No tracked ticketing or identity check beyond replying from the account email. |
| Retention and erasure | Qualitative on `/privacy`. **Needs numbers** (see section 4). |
| Children | 18+ only; confirmation text at sign-up; no age verification. DPDP requires verifiable parental consent for under 18 if minors were allowed, so the 18+ gate is the whole control. |
| Breach notification | Promise on `/privacy`. **Gap:** no written incident procedure in the repo. |
| Cross-border transfers | Disclosed in general terms (Anthropic, Google, Supabase, Vercel, Stripe, Resend). Not mapped to regions. |
| Processor contracts | Not verifiable from the repo. |
| Notice in Eighth Schedule languages on request | Promised on `/privacy`; there is no translated notice. |
| Significant Data Fiduciary / DPO obligations | Not assessed. |

## 4. Facts to confirm before the pages can be called accurate

1. Supabase project region, and the backup window on the current plan (wording says copies expire "on their own schedule").
2. How long request logs, Vercel logs and moderation outcomes are actually kept.
3. How long Stripe and tax records must be kept for Technektar's invoices.
4. Whether reports, takedown decisions and moderation emails need a fixed retention period (currently: kept while needed for appeals/abuse).
5. Whether any listen/play analytics, session replay or ad tooling runs anywhere (none found in the repo).
6. Whether Resend, Anthropic and Google offer a no-training/zero-retention setting that is actually enabled on our accounts. The pages say private songs are not used to train models; that is our practice, but provider-side retention is theirs.

## 5. Questions for a lawyer

1. **Ownership of AI output.** Is the wording in `/terms` ("no ownership claimed; worldwide, non-exclusive, perpetual licence; commercial use on Pro") acceptable given unsettled authorship law in India, and should the Free tier's commercial rights be stated explicitly?
2. **Provider terms flow-down.** Do Google's (Lyria/Gemini) and Anthropic's terms restrict commercial use of output or require specific end-user terms or disclosures that we should mirror?
3. **Similarity risk.** Is the "you are responsible before commercial release" allocation enough, or do we need a stronger indemnity/disclaimer? Is the SynthID statement safe to keep, since it comes from Google's documentation?
4. **Intermediary status.** Are the 24 h / 36 h / 15-day timelines right for our situation under the IT Rules, and should the Grievance Officer be named with an address? Is a notice-and-appeal process needed for users whose songs are taken down, beyond emailing grievance@?
5. **Synthetic-content labelling.** Do current or proposed Indian rules on labelling AI-generated media require more than the "AI-generated" label on public songs and share cards?
6. **Real names in dedications and personality rights.** Dedications name third parties on public pages. Is screening plus a user warranty enough, and should there be a faster removal path for the named person?
7. **Consent design.** Is notice-plus-sign-up acceptable for core processing, or should we collect and store an explicit, versioned consent record for each purpose?
8. **Children.** Is a self-declared 18+ gate sufficient, and what should we do on discovering a minor's account?
9. **Cross-border transfer wording** and whether a transfer-impact note per processor is needed.
10. **Liability cap and governing law** (3 months' fees; Bengaluru courts) for consumers.
11. **Refund and GST wording** in billing, and whether Stripe's invoices satisfy GST requirements.
12. **Voice/likeness.** Confirm that blocking named-artist imitation (and describing it in `/content-policy`) is the right policy line, and whether tributes to deceased artists should be addressed explicitly.
13. **Rights holders' takedowns.** Do we need a dedicated copyright notice template and counter-notice flow rather than a single email?

## 6. Known product gaps found during this pass

- Sign-up had no notice or terms link before this change.
- Account deletion copy contradicted the code (fixed).
- Takedown/appeal is manual: no tracked appeals queue, only email to the grievance mailbox. Reinstatement exists in the API (`POST /api/admin/reports/resolve` with `action: reinstate`) but not in any admin UI.
- The legacy `report_song` RPC and anon insert policy on `song_reports` still exist from migration 0024/0027; `/api/report` is the supported path.
- Last-updated date is hard-coded in each page; bump it whenever copy changes.
