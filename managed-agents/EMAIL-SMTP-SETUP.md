# Transactional email for sign-up / password reset (≈15 min)

Supabase's built-in sender is rate-limited to a handful of emails per hour and is for testing only. Real users need your own SMTP.
Recommended: **Resend** (free tier 3,000 emails/month, simple DNS verification). Any SMTP works (Brevo, Postmark, Amazon SES).

## 1. Resend
1. https://resend.com/signup → **Domains → Add domain** → `neo-fm.com` (region: closest to India, e.g. ap-south-1 / Singapore if offered).
2. Resend shows 3–4 DNS records (SPF/DKIM TXT + MX for the `send.` subdomain). Add them wherever DNS for neo-fm.com lives:
   - If DNS is still at **GoDaddy**: GoDaddy → My Products → neo-fm.com → DNS → add the records exactly as shown.
   - If you moved the nameservers to **Vercel** (cutover step): tell me, and I add the records myself via the Vercel connector.
3. Click **Verify** until it shows *Verified*.
4. **API Keys → Create** (permission: *Sending access*, domain: neo-fm.com). Copy the key — never paste it in chat.

## 2. Supabase `neo-fm-prod`
https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/smtp → **Enable Custom SMTP**:
| Field | Value |
|---|---|
| Sender email | `noreply@neo-fm.com` |
| Sender name | `neo-fm` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key |
Save. Then Authentication → **Rate Limits**: raise "emails sent per hour" to something sane (e.g. 100).

## 3. Email templates (optional polish)
https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/templates — set subject lines ("Confirm your neo-fm account"), keep `{{ .ConfirmationURL }}`.

## 4. Verify
Create a new account with a real inbox at https://neo-fm.com/sign-up (after cutover) or on the preview, and confirm the email arrives from `noreply@neo-fm.com` and the link lands on the site (not localhost).
