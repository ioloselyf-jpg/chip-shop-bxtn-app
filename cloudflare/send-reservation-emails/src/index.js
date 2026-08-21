// Sends a guest confirmation + a staff alert email when a table reservation
// is made. Called by js/reserve.js via fetch() right after the Firestore
// write succeeds — this is a best-effort layer on top of that write, not a
// replacement for it. The reservation is already "confirmed" in Firestore
// by the time this runs, so a failure here (missing API key, SendGrid being
// down, a bad address) must never look like a failed booking to the guest;
// reserve.js already treats this call as fire-and-forget for that reason.
//
// Ported from netlify/functions/send-reservation-emails.js when the site
// moved off Netlify to GitHub Pages (GitHub Pages is static-only and can't
// run this).
//
// Sends via SendGrid's HTTP API (2026-08-20), not raw SMTP — raw SMTP via
// nodemailer was tried first (matching the original Netlify function) but
// confirmed broken on Cloudflare Workers: even with the nodejs_compat flag,
// the TCP-socket-backed net/tls polyfill couldn't resolve/connect to
// smtpout.secureserver.net from inside a Worker (verified live via
// `wrangler tail`: "Failed to resolve IPv4 addresses with current network",
// then "Connection timeout" on both sends). An HTTP API sidesteps that
// entirely — it's a plain fetch(), no raw sockets involved.
//
// SendGrid over Resend specifically because Resend requires a *verified
// domain* to send to arbitrary recipients (no way around it, confirmed
// against Resend's own docs) — and the owner has no DNS access for
// chipshopbxtn.co.uk, which is exactly the wall this project hit in
// Resend's very first attempt (see README "Reservation emails" history).
// SendGrid's Single Sender Verification only requires clicking a
// confirmation link sent to iolo@chipshopbxtn.co.uk (a mailbox the owner
// does control) — no DNS involved — and once verified, that address can
// send to any recipient. Free tier, no card required to start.

const STAFF_EMAIL = "iolo@chipshopbxtn.co.uk";

const SHOP_ADDRESS = "378 Coldharbour Lane, Brixton, London SW9 8LF";
const SHOP_PHONE = "020 7274 3350";

function pad(n) {
  return String(n).padStart(2, "0");
}

// "Sat 16 Aug 2026" — same weekday/day/month convention used on djs.html
// and elsewhere in the app, plus the year since this goes out over email
// and could be read well after the fact.
function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  return `${weekday} ${d.getDate()} ${month} ${d.getFullYear()}`;
}

// Reservation times can have an hour part >= 24 for overnight slots (e.g.
// "24:30" = 12:30 AM the next day) — same convention as reserve.js/staff.js.
function formatTime(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!match) return hhmm;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const totalMins = h * 60 + m;
  const isNextDay = totalMins >= 1440;
  const normalized = ((totalMins % 1440) + 1440) % 1440;
  let hour12 = Math.floor(normalized / 60);
  const ampm = hour12 >= 12 ? "PM" : "AM";
  hour12 = hour12 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${pad(normalized % 60)} ${ampm}${isNextDay ? " (next day)" : ""}`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function guestEmailHtml(r) {
  const notesRow = r.notes
    ? `<tr><td style="padding:6px 0; color:#6b6b6b;">Notes</td><td style="padding:6px 0; text-align:right;">${escapeHtml(r.notes)}</td></tr>`
    : "";
  return `
  <div style="font-family:Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; color:#0d0d0d;">
    <div style="background:#0d0d0d; padding:20px 24px;">
      <span style="color:#fb0000; font-weight:700; font-size:0.75rem; letter-spacing:0.12em; text-transform:uppercase;">Chip Shop Bxtn</span>
      <h1 style="color:#fff; font-size:1.5rem; margin:8px 0 0;">Table booked ✅</h1>
    </div>
    <div style="padding:24px; background:#fafafa;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(r.name)}, you're locked in. See you at the counter.</p>
      <table style="width:100%; border-collapse:collapse; font-size:0.95rem;">
        <tr><td style="padding:6px 0; color:#6b6b6b;">Date</td><td style="padding:6px 0; text-align:right; font-weight:600;">${escapeHtml(formatDate(r.date))}</td></tr>
        <tr><td style="padding:6px 0; color:#6b6b6b;">Time</td><td style="padding:6px 0; text-align:right; font-weight:600;">${escapeHtml(formatTime(r.time))}</td></tr>
        <tr><td style="padding:6px 0; color:#6b6b6b;">Party size</td><td style="padding:6px 0; text-align:right; font-weight:600;">${escapeHtml(r.partySize)}</td></tr>
        <tr><td style="padding:6px 0; color:#6b6b6b;">Name</td><td style="padding:6px 0; text-align:right;">${escapeHtml(r.name)}</td></tr>
        ${notesRow}
      </table>
      <p style="margin:20px 0 0; font-size:0.85rem; color:#6b6b6b;">
        Need to change or cancel? Call us on ${SHOP_PHONE} — ${SHOP_ADDRESS}.
      </p>
    </div>
  </div>`;
}

function staffEmailHtml(r) {
  const notesRow = r.notes
    ? `<tr><td style="padding:6px 10px; color:#6b6b6b; border-bottom:1px solid #e0e0e0;">Notes</td><td style="padding:6px 10px; border-bottom:1px solid #e0e0e0;">${escapeHtml(r.notes)}</td></tr>`
    : "";
  return `
  <div style="font-family:Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; color:#0d0d0d;">
    <h2 style="color:#fb0000; margin:0 0 12px;">New reservation</h2>
    <table style="width:100%; border-collapse:collapse; font-size:0.95rem;">
      <tr><td style="padding:6px 10px; color:#6b6b6b; border-bottom:1px solid #e0e0e0;">Name</td><td style="padding:6px 10px; border-bottom:1px solid #e0e0e0; font-weight:600;">${escapeHtml(r.name)}</td></tr>
      <tr><td style="padding:6px 10px; color:#6b6b6b; border-bottom:1px solid #e0e0e0;">Date</td><td style="padding:6px 10px; border-bottom:1px solid #e0e0e0;">${escapeHtml(formatDate(r.date))}</td></tr>
      <tr><td style="padding:6px 10px; color:#6b6b6b; border-bottom:1px solid #e0e0e0;">Time</td><td style="padding:6px 10px; border-bottom:1px solid #e0e0e0;">${escapeHtml(formatTime(r.time))}</td></tr>
      <tr><td style="padding:6px 10px; color:#6b6b6b; border-bottom:1px solid #e0e0e0;">Party size</td><td style="padding:6px 10px; border-bottom:1px solid #e0e0e0;">${escapeHtml(r.partySize)}</td></tr>
      <tr><td style="padding:6px 10px; color:#6b6b6b; border-bottom:1px solid #e0e0e0;">Phone</td><td style="padding:6px 10px; border-bottom:1px solid #e0e0e0;">${escapeHtml(r.phone)}</td></tr>
      <tr><td style="padding:6px 10px; color:#6b6b6b; border-bottom:1px solid #e0e0e0;">Email</td><td style="padding:6px 10px; border-bottom:1px solid #e0e0e0;">${escapeHtml(r.email)}</td></tr>
      ${notesRow}
    </table>
  </div>`;
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function jsonResponse(statusCode, data, env) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) }
  });
}

// Sends one email via SendGrid's v3 Mail Send API. Throws on any non-2xx
// response (mirrors nodemailer's sendMail() rejecting on failure), so the
// Promise.allSettled() call site below can tell guest/staff sends apart.
async function sendViaSendGrid(env, { to, subject, html }) {
  const fromEmail = env.SENDGRID_FROM_EMAIL || STAFF_EMAIL;
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: "Chip Shop Bxtn" },
      subject,
      content: [{ type: "text/html", value: html }]
    })
  });

  if (!res.ok) {
    // SendGrid returns a JSON {errors: [...]} body on failure — surface it
    // so a bad/unverified sender or bad API key shows up clearly in
    // `wrangler tail` instead of just "non-2xx response".
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid ${res.status}: ${body}`);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" }, env);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return jsonResponse(400, { error: "Invalid JSON body" }, env);
    }

    const { name, email, phone, partySize, date, time, notes } = payload;
    if (!name || !email || !date || !time || !partySize) {
      return jsonResponse(400, { error: "Missing required reservation fields (name, email, date, time, partySize)" }, env);
    }

    // Fail clearly and cleanly if the API key isn't configured yet, rather
    // than letting the fetch below blow up with a less obvious error.
    // reserve.js ignores this response either way, so it's safe for this to
    // 500 — the booking itself already succeeded before this function ran.
    if (!env.SENDGRID_API_KEY) {
      console.error("SENDGRID_API_KEY is not set — skipping reservation emails.");
      return jsonResponse(500, { error: "Email sending is not configured (SENDGRID_API_KEY missing)." }, env);
    }

    const reservation = { name, email, phone, partySize, date, time, notes };

    const [guestResult, staffResult] = await Promise.allSettled([
      sendViaSendGrid(env, {
        to: email,
        subject: "Your table's booked — Chip Shop Bxtn",
        html: guestEmailHtml(reservation)
      }),
      sendViaSendGrid(env, {
        to: STAFF_EMAIL,
        subject: `New reservation: ${name}, party of ${partySize} — ${date}`,
        html: staffEmailHtml(reservation)
      })
    ]);

    const guestOk = guestResult.status === "fulfilled";
    const staffOk = staffResult.status === "fulfilled";

    if (!guestOk) console.error("Guest email failed:", guestResult.reason);
    if (!staffOk) console.error("Staff email failed:", staffResult.reason);

    if (!guestOk || !staffOk) {
      return jsonResponse(207, { ok: guestOk || staffOk, guestEmailSent: guestOk, staffEmailSent: staffOk }, env);
    }

    return jsonResponse(200, { ok: true, guestEmailSent: true, staffEmailSent: true }, env);
  }
};
