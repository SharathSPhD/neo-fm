# DPDP export/delete verification (run against a throwaway account, Stripe TEST mode only)

1. Sign up `dpdp-test-<timestamp>@neo-fm.test`, note the user id `$UID`.
2. Create a song (completes), a user preset, like a song, give feedback text on /feedback, run a test checkout (4242 card).
3. Signed in, `GET /api/account/export`. Expect 200, `export_version: 3`, non-empty `songs`, `presets`, `feedback`, `billing`.
4. Before delete, record (SQL, replace `$UID`):
```sql
select count(*) from public.jobs where user_id = '$UID';
select count(*) from public.feedback where user_id = '$UID';
select stripe_customer_id, stripe_subscription_id from public.user_billing where user_id = '$UID';
select count(*) from storage.objects where bucket_id = 'tracks' and (storage.foldername(name))[1] in (select id::text from public.jobs where user_id = '$UID');
select count(*) from storage.objects where bucket_id = 'cover-art' and (storage.foldername(name))[1] = '$UID';
```
5. `DELETE /api/account` while signed in. Expect 200 `{deleted:true, steps:{subscription, stripe_customer, audio_files_removed, feedback}}`.
6. After delete, all of these must be 0 / empty:
```sql
select count(*) from auth.users where id = '$UID';
select count(*) from public.users where id = '$UID';
select count(*) from public.jobs where user_id = '$UID';
select count(*) from public.feedback where user_id = '$UID';
select count(*) from public.user_billing where user_id = '$UID';
select count(*) from public.user_presets where user_id = '$UID';
select count(*) from public.song_likes where user_id = '$UID';
select count(*) from public.feedback_events where user_id = '$UID';
select count(*) from public.consents where user_id = '$UID';
select count(*) from public.taste_profiles where user_id = '$UID';
select count(*) from public.user_spend where user_id = '$UID';
select count(*) from storage.objects where bucket_id in ('tracks','cover-art') and (name like '$UID/%' or (storage.foldername(name))[1] in (<job ids recorded in step 4>));
```
7. Stripe (test mode): the customer from step 4 is deleted and the subscription is cancelled (Dashboard, or `GET /v1/customers/<id>` returns `deleted: true`).
8. Within a few minutes, `stripe_webhook_events` shows the `customer.subscription.deleted` event as `processed` (or the webhook returned `skipped: user_deleted`), never retrying.
Known gap: `pricing_waitlist` rows keyed by email are not erased by account deletion.
