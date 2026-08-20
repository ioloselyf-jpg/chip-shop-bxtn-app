# Reservation emails — Cloudflare Worker

Sends the guest confirmation + staff alert email after a table booking.
Ported here from `netlify/functions/send-reservation-emails.js` when the
site moved off Netlify onto GitHub Pages — GitHub Pages is static-only and
can't run server-side code, so this piece needed a new home. Logic is
unchanged; only the request/response plumbing and CORS are new (this now
runs on a different origin than the site itself, where it used to be
same-origin under Netlify).

**Not live yet** — same as before the move, it just needs the mailbox
password. Until then it returns a clean 500 (logged, harmless) and bookings
work fine without it — `js/reserve.js` calls it fire-and-forget and ignores
the response either way.

## One-time setup

1. Install the CLI (from this folder): `npm install`
2. Log in: `npx wrangler login` (opens a browser to authorize against your
   Cloudflare account — free tier is enough for this).
3. Deploy: `npx wrangler deploy`
   This creates the Worker and prints its URL, something like:
   `https://chip-shop-bxtn-reservation-emails.<your-subdomain>.workers.dev`
4. Copy that URL into `config/site-config.json` at the repo root, under
   `reservations.emailWorkerUrl` (see the placeholder comment there). Commit
   and push — the reserve page reads this at runtime, no code change needed.
5. Set the SMTP secrets (get the mailbox password from the owner first):
   ```
   npx wrangler secret put SMTP_USER
   # paste: iolo@chipshopbxtn.co.uk

   npx wrangler secret put SMTP_PASSWORD
   # paste: the mailbox password
   ```
   `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_FROM_EMAIL` are optional
   — they default to the documented 123 Reg settings (see the code
   comments) and normally don't need setting.
6. If the site ever moves off `https://ioloselyf-jpg.github.io` (e.g. a
   custom domain), update `ALLOWED_ORIGIN` in `wrangler.toml` to match and
   redeploy — otherwise the browser will reject the response as a CORS
   failure even though the email still sends.
7. Do one real test booking end-to-end and confirm both emails land.

## Local dev

`npx wrangler dev` runs the Worker locally. Put secrets for local testing in
a `.dev.vars` file in this folder (gitignored, never commit it):
```
SMTP_USER=iolo@chipshopbxtn.co.uk
SMTP_PASSWORD=...
```

## Redeploying after a code change

`npx wrangler deploy` — secrets and vars already set on the Worker persist
across deploys, you don't need to re-set them.
