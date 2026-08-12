# Chip Shop Bxtn — Guest App (MVP)

A guest-facing Progressive Web App (PWA) for Chip Shop Bxtn — separate from the
Blinq POS / operations hub. Installs via Safari "Add to Home Screen" on iOS,
no App Store account or Mac required.

**Three features, built in priority order:**
1. **What's On This Week** — specials/events, editable by staff via a simple in-app form (no redeploy needed).
2. **Loyalty Card** — buy 8, get 1 free digital stamp card. Customer sign-up/login + a PIN-protected staff view to add stamps and redeem rewards.
3. **Table Reservations** — date/time/party-size booking with overbooking prevention against the real 80-cover capacity.

Everything is static HTML/CSS/JS (no build step, no framework) using **Firebase**
(Spark free tier) for auth, database, and hosting.

---

## ⚠️ This is a prototype. Read this before showing it to a real customer.

As of 2026-08-11, the following are **real, not placeholder**:

| Item | Where | Source |
|---|---|---|
| Opening hours | `config/site-config.json` → `reservations.openingHours` | Given directly by the owner (2026-08-11) |
| Table capacity | `config/site-config.json` → `reservations.capacityPerSlotCovers` (80) | Given directly by the owner (2026-08-11) |
| Max party size | `config/site-config.json` → `reservations.maxPartySize` (20) | Given directly by the owner (2026-08-11) |
| Branding — colors, font, logo | `css/style.css`, `config/site-config.json` → `theme.*`, `/icons/*` | Sourced from [chipshopbxtn.com](https://www.chipshopbxtn.com) (2026-08-11) — see "Branding" below |
| Firebase project | `js/firebase-config.js` | Real `chip-shop-bxtn` project, confirmed live |
| Staff PIN | Firebase Auth user password | Set by the owner directly in Firebase Auth |
| Contact info (phone, email, address) | `index.html` → `#contact` section | Sourced from [chipshopbxtn.com/contact](https://www.chipshopbxtn.com/contact) (2026-08-12) — see "Setup status" below |
| Loyalty threshold | `config/site-config.json` → `loyalty.stampsRequired` (8) | Owner-requested change (2026-08-12), was 9 |

Nothing left in this MVP's core business data is still a placeholder — the
open items now are deployment/ops housekeeping (see "Setup status" below),
not missing real-world numbers.

---

## Setup status (last checked 2026-08-12, against the live `chip-shop-bxtn` project)

**2026-08-12 (About page session) — Chuck D tagline + About page verified, deploy zip rebuilt:**
- A prior session (interrupted mid-deploy-zip-rebuild) had already made two content changes; this session verified both landed correctly and completed the rest of the job: the homepage tagline is now the Chuck D quote (`"Chip Shop is the center of the universe 4 HIP HOP" — Chuck D`, styled as a quote citation, `index.html` + `config/site-config.json`), and `about.html` exists with the hip-hop-history copy, styled consistent with the other pages (torn-edge, halftone, compact hero — reuses the homepage hero photo since no dedicated About photo exists). "About" is in the nav on all five guest pages with correct active-state highlighting; `staff.html` correctly excluded. Service worker already at `v7` with `about.html` precached.
- **Rebuilding the deploy zip surfaced a real bug, now fixed**: the straightforward `Compress-Archive` approach (and even .NET's `ZipFile.CreateFromDirectory`, in this environment) wrote zip entries with **backslash** path separators (`icons\logo.png`) instead of the forward slashes the original working zip used (`icons/logo.png`). Netlify's Linux-based unzip treats backslash as a literal filename character, not a folder separator — deploying a backslash-separated zip would have flattened `icons/`, `css/`, `js/`, `config/`, `fonts/`, `images/` into garbled root-level filenames and broken every asset reference on the live site. Fixed by building the zip manually via `ZipArchive.CreateEntry()` with explicitly forward-slash-normalized entry names. Verified byte-for-byte: extracted the rebuilt zip and diffed it against the live source tree (only expected difference: `icons/source/`, a dev-only asset never meant for deploy) — 28 entries, all forward-slash paths, confirmed via raw byte inspection.
- **If you ever rebuild this zip by hand on Windows** (PowerShell's `Compress-Archive`), double-check the entry separators before uploading — this is apparently not a one-off fluke, it reproduced with two different zip-building approaches in this environment.

**2026-08-12 (continuation session) — staff login fixed, nav bar added, loyalty threshold changed:**
- **🔴→✅ Staff login fixed — the "Round 3" conclusion below (`ioloselyf@gmail.com`) was wrong.** The real staff Auth account is **`iolo@chipshopbxtn.co.uk`**, password `831106` — confirmed directly against the Firebase Auth REST API (`identitytoolkit accounts:signInWithPassword` returned a valid token for that exact email/password). Updated `config/site-config.json` (`staff.staffAuthEmail`) and `firestore.rules` (`isStaff()`'s hardcoded email) to `iolo@chipshopbxtn.co.uk`. **`firestore.rules` changed, so it needs republishing** (Firebase Console → Firestore Database → Rules → paste → Publish) — the config.json change alone doesn't need that, but both need the site redeployed. See "Not yet done" below.
- **Nav bar added** to the four guest-facing pages (`index.html`, `whats-on.html`, `loyalty.html`, `reserve.html` — not `staff.html`): Home / What's On / Loyalty / Reserve / Contact Us, styled as a black pill-nav sitting on the torn-edge strip (Loyalty was added after an initial Home/What's On/Reserve/Contact version flagged its absence).
- **Contact Us section added** to `index.html` (`#contact` anchor, linked from the nav on every guest page) — no dedicated contact page existed, so real contact details were sourced from the shop's live site (`chipshopbxtn.com/contact`, fetched 2026-08-12): phone `020 7274 3350`, email `info@chipshopbxtn.co.uk`, address `378 Coldharbour Lane, Brixton, London SW9 8LF`. **Note:** that same live page lists different opening hours than what's in `config/site-config.json` (e.g. it shows Mon/Wed open, Sat 3pm start) — left untouched since this app's hours came directly from the owner in chat, which takes precedence over the shop's public website, but worth a sanity check if hours ever seem off.
- **Loyalty threshold changed from 9 to 8** — `config/site-config.json` (`loyalty.stampsRequired`), plus the hardcoded fallback defaults and UI text that also said 9: `js/loyalty.js`, `js/staff.js`, and the `loyalty.html` hero subtitle ("Buy 8, get 1 free"). The stamp grid and progress text are driven by `stampsRequired` dynamically, so no other logic changes were needed.
- Service worker cache bumped to `v6` (all of the above touch precached shell files).
- Deploy zip rebuilt with all of the above — see "Not yet done" below for what still needs manual action.

**2026-08-12 (later same day) — tagline swapped for a Chuck D quote, new About page added:**
- **Tagline replaced.** "Fresh fish, proper chips, no nonsense." → **"Chip Shop is the center of the universe 4 HIP HOP" — Chuck D**, on the homepage hero. It only ever appeared in two places: `config/site-config.json` → `tagline` (drives the `[data-tagline]` element via `js/firebase-init.js#applyTheme`) and the matching fallback text in `index.html`. Both updated. The quote and attribution are separate elements now — `config.tagline` holds just the quote text (still config-driven), while the "— Chuck D" citation is a hardcoded `<cite class="hero-quote-cite">` sibling styled as a small red uppercase caption (new CSS in `css/style.css`) — this keeps the citation visually distinct without `applyTheme()`'s plain-text `.textContent` swap clobbering it.
- **New About page** (`about.html`) added with the venue-history copy, styled like the other guest pages: compact hero with back-link/halftones/torn-edge, prose in a `.card`. No dedicated About photo exists yet, so it reuses `images/hero-home.webp` (same image as the homepage hero) — worth commissioning a proper photo later if you want it visually distinct from the homepage.
- **Nav bar updated on all five guest pages** (added `about.html` itself to the nav-bar rotation, plus the About link to index/whats-on/loyalty/reserve): now reads Home / What's On / Loyalty / Reserve / About / Contact Us.
- `service-worker.js`: added `/about.html` to the precached shell list, cache bumped to `v7`.
- Deploy zip rebuilt again with these changes — confirmed by extracting it that `about.html` is present and `index.html` inside the zip has both the new quote and the About nav link. **No `firestore.rules` change this round** — this was static content/nav only, nothing touches Firestore access rules, so no republish needed for this part.

**2026-08-12 (earlier session) — site is live at https://chipshopbxtn.netlify.app (renamed from the old random Netlify subdomain), staff login/search/redesign all confirmed working end-to-end. Two things fixed that session:**
- **Reservation date picker "not working" in dark mode** — root cause: the page never declared the CSS `color-scheme` property, so the native date-input calendar icon (and `<select>` dropdown arrows) defaulted to light-mode assumptions and rendered invisible against our dark-mode black inputs. The underlying date/hours *logic* was never broken — verified all 7 days of the week generate correct slots both before and after this fix. Fixed by adding `color-scheme: light` to `:root` and `color-scheme: dark` inside the existing dark-mode media query (`css/style.css`), so native form-control chrome now matches whichever palette is actually active.
- **Fri/Sat opening time corrected**: was 16:00, now 18:00 (close time unchanged at 01:00 overnight). Thu/Sun (18:00–00:00) and Mon/Tue/Wed (closed) are unchanged. Verified all five affected/adjacent days generate correct slot lists after the change.
- Service worker cache bumped to `v3` (both `css/style.css` and `config/site-config.json` are precached shell files, so a version bump is required for clients to pick up either fix promptly rather than waiting on the network-first fallback).

**Done:**
- [x] Firebase project created (`chip-shop-bxtn`, Firestore in `europe-west2`, production mode)
- [x] Email/Password Auth enabled
- [x] One staff Auth user created — `iolo@chipshopbxtn.co.uk` (see "Round 3" below for the history here — that round's conclusion of `ioloselyf@gmail.com` was itself wrong, corrected 2026-08-12; see the update at the top of this section), matching `config/site-config.json` and `firestore.rules`
- [x] Web app registered in Firebase; real config plugged into `js/firebase-config.js`
- [x] **Firestore rules published and confirmed live**, re-checked twice now (2026-08-10). Full read/write matrix against the real project, both times: public read of `specials` ✅, public create of `reservations` ✅, public read+write of `slotCounts` ✅, unauthenticated write to `specials` ❌ correctly denied, unauthenticated read of `reservations` (both list and single-doc `get`) ❌ correctly denied. Staff-only enforcement is holding, not just "everything open."
- [x] **`whats-on.html` bug found and fixed**: the specials query needed a Firestore composite index it didn't have. Fixed by sorting client-side instead of server-side (`js/whats-on.js`). Re-verified twice against the live project — page renders correctly both times.
- [x] **First round's two test docs (`reservations` "Smoke Test" + `slotCounts/2099-01-01_12:00`) confirmed cleared** — I could directly verify `slotCounts/2099-01-01_12:00` was gone (that collection is public-read). I **cannot** verify the `reservations` doc the same way — reading that collection correctly requires staff auth, which I don't use, so I have no way to list or `get` it myself. Since the site's `reservations` read is staff-gated by design, treat "I can't see it" as expected, not as proof either way — if you (or whoever cleared the first batch) deleted it from the Firebase Console, it's gone; I just can't independently confirm that one from here.

**⚠️ This verification pass itself wrote two new throwaway documents** (this is unavoidable — a real `create` is the only way to test the create rule): another `reservations` doc (`name: "Smoke Test 3"`, `date: "2099-01-01"`, `time: "13:00"`) and it recreated `slotCounts/2099-01-01_12:00`. Same cleanup as before applies — remove both via Firebase Console → Firestore Database → Data before going live. Consider this expected overhead of each verification pass rather than a one-time cleanup — if you ask for another full re-test later, expect one more throwaway `reservations` doc each time.

**Confirmed live** (verified directly against the deployed site, 2026-08-11): real opening hours (including the Fri/Sat overnight wrap past midnight), 80-cover capacity, and branding (logo, red/black/white, Helvetica Neue) — see "Opening hours", "How capacity works", and "Branding" below.

**Made since that verification, not live yet — needs a redeploy:**
- [x] Max party size corrected from a placeholder 8 to the real 20 (owner-confirmed, 2026-08-11) — `config/site-config.json` and the `reserve.js` fallback default both updated. `firestore.rules`' `partySize <= 20` sanity bound was already exactly 20, so no rule change was needed there — just confirmed it's still consistent.

**Staff PIN login — the sign-in call itself is confirmed working** (2026-08-11, user screenshot showing the unlocked dashboard UI). That screenshot showed the tab buttons rendering, which is not the same as confirming the Specials/Reservations tab *content* actually loaded — worth flagging since it fed into an incorrect diagnosis below.

**🔴 Bug: staff customer search (`Add Stamp` tab) failed with `permission-denied` for a real, authenticated staff session.** Two rounds on this:

*Round 1 (wrong):* I originally guessed this was a Firestore `list`-vs-`get` rules subtlety specific to the `customers` collection's combined `isStaff() || auth.uid==uid` read rule, and split it into separate `get`/`list` rules. **This did not fix it** — the user confirmed the search still failed after that rules republish. On reflection this theory didn't hold up: `isStaff()` doesn't reference `resource.data` at all, so there's no real reason it should behave differently for `get` vs `list`. That fix is harmless and still in `firestore.rules` (splitting them is reasonable practice regardless), but it wasn't the actual cause.

*Round 2 (current best fix):* Re-investigated the client-side wiring per a more targeted set of checks — confirmed there's exactly one `initializeApp()` call (`js/firebase-init.js`), every page imports the same shared `auth`/`db` singletons (no second/disconnected Firebase instance anywhere), and `firestore.rules`' hardcoded email string has no hidden whitespace or lookalike characters (checked byte-by-byte). That narrowed it to a real, well-known Firebase gotcha: **Firebase Auth's sign-in email lookup is case-insensitive, but the account's stored email (what `request.auth.token.email` actually returns server-side) preserves whatever casing was used when the account was created in the console — and Firestore rules string equality is case-sensitive.** If the console account was created with any casing different from the exact lowercase string hardcoded in `isStaff()`, PIN login succeeds (case-insensitive lookup) while `isStaff()` silently and permanently evaluates false for *every* collection — matching "login works, every staff-gated read fails, public reads are fine" exactly. This also means the Round 1 diagnosis was built on a false premise: reservations/specials were likely *also* failing the whole time, not just customers, since all three depend on the same `isStaff()`.

**Fix (Round 2):** `isStaff()` compares `request.auth.token.email.lower() == "..."` — robust against casing differences. Also added a visible diagnostic to `staff.html`/`staff.js`: once logged in, the dashboard shows "Signed in as: {email}" (and flags if it doesn't match the configured staff email), so this class of issue is readable directly off the screen next time, no devtools needed.

*Round 3 (2026-08-11 — later found to be wrong, see 2026-08-12 correction at the top of "Setup status"):* the "Signed in as" banner from Round 2 immediately answered the question — the account signed into `staff.html` appeared to be **`ioloselyf@gmail.com`**, not `iolo@chipshopbxtn.co.uk` at all, so that session updated `firestore.rules`, `config/site-config.json`, and this README to `ioloselyf@gmail.com` everywhere. **This turned out to be the wrong address** — the 2026-08-12 continuation session verified directly against the Firebase Auth REST API that `iolo@chipshopbxtn.co.uk` / the owner-supplied password is the real, working account, and reverted all three back to `iolo@chipshopbxtn.co.uk`. The case-insensitive `.lower()` comparison from Round 2 is still in place as a hedge against this exact class of mismatch recurring, regardless of which address is correct.

**Needs both a rules republish AND a site redeploy (2026-08-12 fix):**
1. Firebase Console → **Firestore Database → Rules** tab → paste the full current contents of [`firestore.rules`](./firestore.rules) → **Publish**. (`firestore.rules` changed — the `isStaff()` email — so this step is required, not optional.)
2. Redeploy the site — the zip is rebuilt and ready (also carries the nav bar and loyalty-threshold changes from the same session).
3. Try logging into `/staff.html` with `iolo@chipshopbxtn.co.uk`. The "Signed in as" banner should show that address with no mismatch warning, and customer search should no longer `permission-denied`.

**Not yet done:**
- [ ] Republish the rules fix above (required — the `isStaff()` email changed again on 2026-08-12)
- [ ] Delete the leftover test documents from earlier verification passes (see above)
- [ ] Redeploy the site — a ready-to-upload zip is already rebuilt with all 2026-08-12 changes
- [ ] Manually verify loyalty sign-up (see note directly below)
- [ ] Add the "Live Ones X Unique Hastings - Open Mic" special for today's event via `/staff.html` → What's On tab (the `dateOverrides` entry for today, 18:00–00:00, is already in `config/site-config.json` — only the specials listing itself is outstanding, and it's a live Firestore write gated by staff auth, so it has to be done from the dashboard once login is confirmed working, not as a code change)

**Why I didn't test loyalty sign-up myself:** it requires creating an account,
which I don't do even against your own systems — that's a hard line for me,
not a judgment call. Please do this 2-minute manual check yourselves:
- On `/loyalty.html`, sign up with a throwaway test email — confirm the stamp
  card screen appears at 0/8, then check Firestore console →
  `customers` collection for the new document.
- Once that test customer exists, also try searching for them by email and
  phone on the staff `Add Stamp` tab — this is the first real end-to-end
  test of the customer-search rules fix above, since I've only been able to
  verify it structurally, not against real signed-up data.
- Delete the test customer doc/Auth user afterward if you don't want it
  lingering in production data.

---

## What you (the account owner) need to do

I can't create accounts or enter passwords/API keys on your behalf. Here's
exactly what's needed, in order.

### 1. Create a Firebase project (free) ✅ done
Project `chip-shop-bxtn` exists on the Spark (free) plan.

### 2. Turn on Firestore (the database) ✅ done
Firestore is enabled in `europe-west2`, production mode, and `firestore.rules`
is published and confirmed live against the real project — see "Setup status"
above. If you ever edit `firestore.rules` again, re-paste the full file into
**Rules** tab → **Publish**, same as before.

### 3. Turn on Authentication ✅ done
Email/Password sign-in is enabled, and one staff user exists for the PIN pad
on `/staff.html`. Reminder: that user's email must exactly match
`config/site-config.json` → `staff.staffAuthEmail` (`iolo@chipshopbxtn.co.uk`)
and the email hardcoded in `firestore.rules` — if you ever change one, change
all three. (`isStaff()` compares case-insensitively as of 2026-08-11, but the
three still need to reference the *same* address, not just the same casing.)

### 4. Get your web app config ✅ done
Real values are already in [`js/firebase-config.js`](./js/firebase-config.js).

### 5. Deploy the site somewhere free
A ready-to-upload zip is kept at the repo root: `chip-shop-bxtn-deploy.zip`
(rebuilt after every change — contains only the actual app files, no
README/rules/dev config). Drag that file's *extracted contents* onto your
host of choice, or drag the zip straight into Netlify's manual-deploy drop
zone if it accepts zips directly.

Pick **one** of these. Netlify is the simplest if you don't want to install anything.

**Option A — Netlify (drag and drop, easiest)**
1. Go to https://app.netlify.com, sign up free.
2. **Add new site → Deploy manually**, then drag the whole project folder in.
3. Netlify gives you a live URL immediately (e.g. `chip-shop-bxtn.netlify.app`). You can add a custom domain later in Site settings.
4. Every time you edit files, drag the folder in again to redeploy (or connect it to a GitHub repo for auto-deploys — optional, ask if you want this set up).

**Option B — Firebase Hosting (keeps everything in one account)**
1. Install the Firebase CLI (needs Node.js): `npm install -g firebase-tools`
2. From this project folder: `firebase login`, then `firebase init hosting` (choose your existing project, set the public directory to `.`, configure as a single-page app: **No**, don't overwrite `index.html`).
3. `firebase deploy --only hosting`

Either way, **the site must be served over HTTPS** for the service worker and "Add to Home Screen" to work — both Netlify and Firebase Hosting give you HTTPS automatically.

### 6. Fill in the real business details — ✅ done
`config/site-config.json` → `reservations.openingHours`, `capacityPerSlotCovers`
(80), and `maxPartySize` (20) are all real, given by the owner (2026-08-11) —
see "Opening hours" below for the exact hours and how to add one-off
event-day overrides.

### 7. Branding — ✅ done, sourced from the real site
Colors, font, and logo are pulled from [chipshopbxtn.com](https://www.chipshopbxtn.com)
— see "Branding" below for exactly what was used and where to update it if
the shop rebrands later.

---

## Branding

Colors, font, and the logo were pulled directly from the live
[chipshopbxtn.com](https://www.chipshopbxtn.com) site on 2026-08-11 (a
Squarespace site), since no separate brand assets existed yet:

- **Red** (`#fb0000`) — measured by sampling the actual logo artwork's
  pixels (average of ~141,000 red pixels came out to `rgb(251,0,0)`), not
  eyeballed.
- **Black** (`#000000`) / **white** (`#ffffff`) — the site's own background
  and text colors (confirmed via its `--siteBackgroundColor` CSS variable,
  which is pure black).
- **Font** — `Helvetica Neue` (with system-font fallbacks), matching the
  live site's own heading font stack. No web font is loaded — Helvetica Neue
  ships on iOS and most systems already, so this costs nothing extra and
  works offline.
- **Logo** — `/icons/logo.png`, downloaded from the site's own CDN
  (`cHIPsHOP_logo.png`, transparent background, used as-is in the header).
  The original download is kept at `/icons/source/chipshop-logo.png` in case
  the icon set ever needs regenerating. All five PWA icon sizes
  (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png`, `favicon.png`) were regenerated from that same
  source, composited onto a solid black square — matching the "black
  version" logo variant already used on the official site.

Because the app's whole light/dark theme is genuinely just three colors, a
few components (badges, the reward banner, the "Redeem" button, filled
loyalty stamps) intentionally use hardcoded red/white/black rather than the
color that flips with the visitor's light/dark mode preference — this avoids
a repeat of the invisible-PIN-pad bug from earlier (dark text landing on a
dark background because a "constant" brand color got paired with a color
that silently flips by mode). If you change `primaryColor`/`accentColor` in
`site-config.json` later, keep in mind those few components assume
whatever color you pick is dark/saturated enough to pair with **white**
text — very light accent colors would need those components revisited.

If the shop rebrands later: swap `/icons/logo.png` (and regenerate the sizes
in `/icons/` the same way, or ask for that to be redone), and update
`theme.*` in `config/site-config.json` plus the `:root` defaults in
`css/style.css`.

---

## Opening hours (reservations)

Real hours from the owner, as of 2026-08-11:

| Day | Hours |
|---|---|
| Mon / Tue / Wed | Closed |
| Thu | 18:00 – 00:00 (midnight) |
| Fri | 16:00 – 01:00 (past midnight) |
| Sat | 16:00 – 01:00 (past midnight) |
| Sun | 18:00 – 00:00 (midnight) |

Mon/Tue/Wed are closed **by default**, but the shop sometimes opens for
one-off events on those days. Two ways to handle that:

1. **One-off date** (recommended, no need to touch the day-of-week defaults): add an entry to `config/site-config.json` → `reservations.dateOverrides`, keyed by the exact date, e.g.:
   ```json
   "dateOverrides": {
     "2026-12-25": { "open": "18:00", "close": "23:00" },
     "2026-08-17": { "closed": true }
   }
   ```
   A date in `dateOverrides` always wins over that day's normal hours — use it to open a normally-closed day for an event, or to close a normally-open day (e.g. a bank holiday). Redeploy after editing.
2. **Change the recurring default** — edit `reservations.openingHours` directly if the change isn't a one-off (e.g. the shop starts regularly opening Wednesdays).

**How "past midnight" is handled**: `fri`/`sat`/`thu`/`sun` all have
`"overnight": true` alongside their `close` time — this tells the slot
generator (`js/reserve.js`) that `close` falls on the *next* calendar day, so
it keeps generating slots past 23:30 instead of wrapping back to the start of
the day. The same `lastSeatingBufferMinutes` (30 min) still applies before
the real close time — e.g. Friday's last bookable slot is 12:30 AM, thirty
minutes before the 1:00 AM close. Internally these late slots are stored as
`"24:00"`, `"24:30"`, etc. (hour part past 23) so they still sort correctly
after the same day's evening slots in the staff dashboard — both `reserve.js`
and `staff.js` convert this back into a normal "12:30 AM (next day)"-style
label for display, so nobody sees the raw `24:30` form.

---

## How capacity works (reservations)

There's no real per-table breakdown, so capacity is modeled simply as **total
covers (seats) per time slot**: 80, the real number given by the owner
(2026-08-11). Each booking adds its party size to a running total for that
date+time; once the total would exceed `capacityPerSlotCovers`, that slot is
refused. This doesn't know about individual table shapes (e.g. a party of 2
taking a 6-top) — if that level of detail becomes useful later, this could be
refined to model individual tables.

Conflict prevention uses a Firestore transaction, so two people booking the
same last slot at the same instant can't both succeed and overbook it.

**No confirmation emails are sent.** Sending real email/SMS confirmations
needs a backend (e.g. a Firebase Cloud Function + an email provider), which
is outside this static-site MVP. The booking page shows an on-screen
confirmation and tells the guest to screenshot it.

---

## Testing locally

Opening the HTML files directly (`file://`) won't work — the app uses ES
modules and `fetch()` for `config/site-config.json`, which browsers block
from `file://`. Run a tiny local web server from the project folder instead,
e.g.:

```
npx serve .
```

or, if you have Python installed:

```
python -m http.server 8080
```

Then open `http://localhost:8080` (or whatever port it prints).

---

## Installing on iPhone (Add to Home Screen)

1. Open the deployed HTTPS URL in **Safari** on iPhone (must be Safari, not Chrome).
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.
3. It now opens full-screen from the home screen like a native app, works offline for pages already visited, and (on iOS 16.4+) can receive push notifications if that's added later.

---

## Project structure

```
index.html            Home — links to the 3 features
whats-on.html / js/whats-on.js       What's On This Week (public, read-only)
loyalty.html   / js/loyalty.js       Customer sign-up/login + stamp card
reserve.html   / js/reserve.js       Table booking form
about.html                           Venue history / About page (static, reuses hero-home.webp)
staff.html     / js/staff.js         PIN-gated staff dashboard (add stamp, edit specials, view bookings)
offline.html                         Shown when offline and page isn't cached
manifest.json                        PWA manifest
service-worker.js                    Caches the app shell for install + offline
config/site-config.json              Editable business config (hours, capacity, loyalty threshold, theme)
js/firebase-config.js                Your Firebase project keys (fill in — see setup step 4)
js/firebase-init.js                  Shared Firebase bootstrap + config/theme loader
firestore.rules                      Firestore security rules (paste into Firebase console)
icons/                                Real PWA icons, generated from the logo — see "Branding" above
icons/logo.png                       Real logo (transparent bg), used in the app header
icons/source/chipshop-logo.png       Original downloaded logo — regenerate icons from this if needed
chip-shop-bxtn-deploy.zip            Ready-to-upload deploy bundle — see setup step 5
```

## Data model (Firestore)

- `specials/{id}` — `{ title, description, weekLabel, date, active, order, updatedAt }` — `date` is an optional `"YYYY-MM-DD"` string (same format as `reservations.date`); when it matches today's local date, the special also appears in the "Tonight at Chip Shop" banner on the homepage (`index.html`)
- `customers/{uid}` — `{ name, email, phone, stamps, rewardsAvailable, totalStampsEver, createdAt }`
- `reservations/{id}` — `{ name, email, phone, partySize, date, time, notes, status, createdAt }`
- `slotCounts/{date_time}` — `{ date, time, covers }` — aggregate headcount per slot, used for the capacity check

## What's not in this MVP (possible next steps)

- Push notifications (technically possible on iOS 16.4+ in the UK, but needs a Cloud Function/server to trigger sends — not built yet)
- Real booking confirmation emails/SMS
- Editing/cancelling a reservation from the guest side (currently guest calls the shop; staff can view the list)
- Per-table (rather than total-covers) capacity modeling
- Firebase App Check, to harden the public write endpoints (reservations, stamp counters) against scripted abuse

## Editing "What's On" day-to-day

No need to touch code or redeploy — go to `/staff.html`, enter the PIN, and
use the **What's On** tab to add/hide/delete specials. Changes appear for
guests immediately.
