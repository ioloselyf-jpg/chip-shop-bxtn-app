import { db, applyTheme } from "./firebase-init.js";
import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

applyTheme();

const contentEl = document.getElementById("content");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function pad(n) { return String(n).padStart(2, "0"); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Sat 16 Aug" — no comma, matches the format used for reservation dates
// elsewhere in the app.
function formatDjDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  return `${weekday} ${d.getDate()} ${month}`;
}

// Soonest date that hasn't passed yet, or null if every date on file is in
// the past (or there are none) — either way, the "Next playing" line is
// just omitted rather than showing something stale.
function nextUpcoming(dates) {
  if (!Array.isArray(dates) || dates.length === 0) return null;
  const today = todayISO();
  const future = dates.filter((d) => typeof d === "string" && d >= today).sort();
  return future[0] || null;
}

function render(djs) {
  if (djs.length === 0) {
    contentEl.innerHTML = `
      <div class="card">
        <p>No resident DJs posted yet — check back soon!</p>
      </div>`;
    return;
  }

  contentEl.innerHTML = djs
    .map((dj) => {
      const next = nextUpcoming(dj.upcomingDates);
      return `
      <div class="card dj-card">
        ${
          dj.photoUrl
            ? `<img class="dj-photo" src="${escapeHtml(dj.photoUrl)}" alt="${escapeHtml(dj.name)}" />`
            : `<div class="dj-photo dj-photo--placeholder">🎧</div>`
        }
        <div class="dj-info">
          <h2>${escapeHtml(dj.name)}</h2>
          ${dj.bio ? `<p>${escapeHtml(dj.bio)}</p>` : ""}
          ${next ? `<p class="hint">Next playing: ${escapeHtml(formatDjDate(next))}</p>` : ""}
          ${dj.instagram ? `<a class="dj-instagram" href="${escapeHtml(dj.instagram)}" target="_blank" rel="noopener">📷 Instagram</a>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

try {
  // Deliberately no orderBy here — combining it with the where() above would
  // need a composite Firestore index. The roster is small, so sort
  // client-side instead, same pattern as whats-on.js.
  const djsQuery = query(collection(db, "djs"), where("active", "==", true));

  onSnapshot(
    djsQuery,
    (snap) => {
      const djs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      render(djs);
    },
    (err) => {
      console.error(err);
      contentEl.innerHTML = `<div class="msg error">Couldn't load the DJ roster right now. Please try again shortly.</div>`;
    }
  );
} catch (err) {
  console.error(err);
  contentEl.innerHTML = `<div class="msg error">Couldn't load the DJ roster right now. Please try again shortly.</div>`;
}
