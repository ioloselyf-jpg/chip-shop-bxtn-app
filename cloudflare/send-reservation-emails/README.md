# Reservation emails — Cloudflare Worker

Sends the guest confirmation + staff alert email after a table booking.
Ported here from `netlify/functions/send-reservation-emails.js` when the
site moved off Netlify onto GitHub Pages — GitHub Pages is static-only and
can't run server-side code, so this piece needed a new home.

**Sends via [SendGrid](https://sendgrid.com)'s HTTP API, not SMTP.** The
Worker was originally a straight port of the Netlify function, sending SMTP
via nodemailer through the owner's 123 Reg mailbox. That's confirmed broken
on Cloudflare Workers (2026-08-20) — verified live with `wrangler tail`:
even with the `nodejs_compat` compatibility flag, the Worker couldn't
resolve/connect to `smtpout.secureserver.net` (`Failed to resolve IPv4
addresses with current network`, then `Connection timeout` on both sends).
Workers' TCP-socket-backed networking doesn't reliably support arbitrary
outbound SMTP the way a normal Node server does. An HTTP API sidesteps the
problem entirely — it's a plain `fetch()`, no raw sockets.

**Why SendGrid and not Resend** (Resend was the *original* provider, before
the SMTP detour): Resend requires a **verified domain** to send to
arbitrary recipients — no way around it, confirmed against Resend's own
docs, and that's the exact wall this project hit back on 2026-08-17 (no DNS
access for `chipshopbxtn.co.uk`; see the git history / older versions of
this section). SendGrid's **Single Sender Verification** only needs a
confirmation-link click sent to `iolo@chipshopbxtn.co.uk` — no DNS involved
— and once that one address is verified, it can send to any recipient.
Free tier, no card required to start.

**Not live yet** — needs a SendGrid account, a verified sender, and an API
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
5. **Set up SendGrid** (in a browser, at https://signup.sendgrid.com — free,
   no card required):
   - Sign up / log in.
   - Go to **Settings → Sender Authentication → Verify a Single Sender**.
   - Enter `iolo@chipshopbxtn.co.uk` as the sender address (and the shop
     name/address when asked).
   - SendGrid emails a confirmation link to that inbox — open it and click
     the link. The sender is now verified; no DNS changes involved.
   - Go to **Settings → API Keys → Create API Key**. "Restricted Access" is
     fine — it only needs **Mail Send** permission. Copy the key
     immediately; SendGrid only shows it once.
6. Set the API key as a Worker secret **from your own terminal** (don't
   paste the key anywhere else, including into chat):
   ```
   npx wrangler secret put SENDGRID_API_KEY
   # paste the key from step 5
   ```
   `SENDGRID_FROM_EMAIL` is optional — defaults to `iolo@chipshopbxtn.co.uk`
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
SENDGRID_API_KEY=...
```

## Redeploying after a code change

`npx wrangler deploy` — secrets and vars already set on the Worker persist
across deploys, you don't need to re-set them.
