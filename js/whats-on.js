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

function render(specials) {
  if (specials.length === 0) {
    contentEl.innerHTML = `
      <div class="card">
        <p>Nothing posted for this week yet — check back soon!</p>
      </div>`;
    return;
  }

  contentEl.innerHTML = specials
    .map(
      (s) => `
      <div class="card">
        ${s.weekLabel ? `<span class="badge">${escapeHtml(s.weekLabel)}</span>` : ""}
        <h2>${escapeHtml(s.title)}</h2>
        <p>${escapeHtml(s.description)}</p>
      </div>`
    )
    .join("");
}

try {
  // Deliberately no orderBy here: combining it with the where() above would
  // need a composite Firestore index. The specials list is small, so sort
  // client-side instead — one less manual setup step for the shop.
  const specialsQuery = query(collection(db, "specials"), where("active", "==", true));

  onSnapshot(
    specialsQuery,
    (snap) => {
      const specials = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      render(specials);
    },
    (err) => {
      console.error(err);
      contentEl.innerHTML = `<div class="msg error">Couldn't load specials right now. Please try again shortly.</div>`;
    }
  );
} catch (err) {
  console.error(err);
  contentEl.innerHTML = `<div class="msg error">Couldn't load specials right now. Please try again shortly.</div>`;
}
