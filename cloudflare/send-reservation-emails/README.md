# Reservation emails — Cloudflare Worker

Sends the guest confirmation + staff alert email after a table booking.
Ported here from `netlify/functions/send-reservation-emails.js` when the
site moved off Netlify onto GitHub Pages — GitHub Pages is static-only and
can't run server-side code, so this piece needed a new home.

**Sends via [Brevo](https://www.brevo.com)'s HTTP API.** Fourth provider
this feature has gone through — the short version:
1. **Resend** — needs a verified *domain* to send to arbitrary recipients,
   no way around it. No DNS access for `chipshopbxtn.co.uk`, hard stop.
2. **Raw SMTP** via nodemailer, through the owner's 123 Reg mailbox —
   worked on Netlify, confirmed **broken on Cloudflare Workers**
   (2026-08-20, verified live with `wrangler tail`: even with the
   `nodejs_compat` compatibility flag, the Worker couldn't
   resolve/connect to `smtpout.secureserver.net` — `Failed to resolve
   IPv4 addresses with current network`, then `Connection timeout` on
   both sends). Workers' sockets don't reliably support arbitrary
   outbound SMTP.
3. **SendGrid**'s HTTP API — worked (plain `fetch()`, no raw sockets, and
   Single Sender Verification sidestepped the domain-DNS wall). Dropped
   *before* going live: SendGrid killed its permanent free tier in
   2025 — new accounts get a 60-day trial, then $19.95/mo minimum, not
   worth it for ~2 emails per booking.
4. **Brevo** (current) — same shape as SendGrid: an HTTP API, and
   **Single Sender Verification** (a code emailed to
   `iolo@chipshopbxtn.co.uk`, no DNS involved — confirmed against Brevo's
   own docs, which explicitly list Single Sender Verification and full
   domain authentication as *alternatives*, not sequential steps). Genuine
   permanent free tier: **300 emails/day, no expiry, no card required**.

**Not live yet** — needs a Brevo account, a verified sender, and an API
key set as a secret (below). Until then the Worker returns a clean 500
(logged, harmless) and bookings work fine without it — `js/reserve.js`
calls it fire-and-forget and ignores the response either way.

## One-time setup

1. Install the CLI (from this folder): `npm install`
2. Log in to Cloudflare: `npx wrangler login` (opens a browser to authorize
   — free tier is enough for this).
3. Deploy: `npx wrangler deploy`
   This creates the Worker and prints its URL, something like:
   `https://chip-shop-bxtn-reservation-emails.<your-subdomain>.workers.dev`
4. Copy that URL into `config/site-config.json` at the repo root, under
   `reservations.emailWorkerUrl`. Commit and push — the reserve page reads
   this at runtime, no code change needed.
5. **Set up Brevo** (in a browser, at https://onboarding.brevo.com/account/register
   — free, no card required):
   - Sign up / log in.
   - Go to **Senders, Domains & Dedicated IPs → Senders → Add a Sender**
     (or **Settings → Senders**, Brevo's nav shifts occasionally).
   - Enter `iolo@chipshopbxtn.co.uk` as the sender address (and a display
     name, e.g. "Chip Shop Bxtn").
   - Brevo emails a 6-digit verification code to that inbox — enter it in
     the dashboard to confirm. The sender is now verified; no DNS changes
     involved. **Don't follow any "authenticate your domain" prompt** —
     that's the DNS-based path and isn't needed here.
   - Go to **Settings → API Keys → Generate a new API key**. Copy it
     immediately; Brevo only shows it once.
6. Set the API key as a Worker secret **from your own terminal** (don't
   paste the key anywhere else, including into chat):
   ```
   npx wrangler secret put BREVO_API_KEY
   # paste the key from step 5
   ```
   `BREVO_FROM_EMAIL` is optional — defaults to `iolo@chipshopbxtn.co.uk`
   (the address verified in step 5). Only set it if you verify a different
   sender later.
7. If the site ever moves off `https://ioloselyf-jpg.github.io` (e.g. a
   custom domain), update `ALLOWED_ORIGIN` in `wrangler.toml` to match and
   redeploy — otherwise the browser will reject the response as a CORS
   failure even though the email still sends.
8. Do one real test booking end-to-end and confirm both emails land.

## Local dev

`npx wrangler dev` runs the Worker locally. Put secrets for local testing in
a `.dev.vars` file in this folder (gitignored, never commit it):
```
BREVO_API_KEY=...
```

## Redeploying after a code change

`npx wrangler deploy` — secrets and vars already set on the Worker persist
across deploys, you don't need to re-set them.
