import { auth, db, applyTheme, loadSiteConfig } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

applyTheme();

let config = null;
let stampsRequired = 8;
let staffEmail = null;

loadSiteConfig().then((cfg) => {
  config = cfg || {};
  stampsRequired = config.loyalty?.stampsRequired || 8;
  staffEmail = config.staff?.staffAuthEmail || null;
  document.getElementById("result-required").textContent = stampsRequired;
});

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

// Reservation times may be stored as "HH:MM" with an hour part >= 24 for
// overnight slots (e.g. "24:30" = 12:30 AM the next day) — see reserve.js.
// Format those back into a readable label for the staff dashboard.
function formatTimeLabel(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const totalMins = h * 60 + m;
  const isNextDay = totalMins >= 1440;
  const normalized = ((totalMins % 1440) + 1440) % 1440;
  let hour12 = Math.floor(normalized / 60);
  const ampm = hour12 >= 12 ? "PM" : "AM";
  hour12 = hour12 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${pad(normalized % 60)} ${ampm}${isNextDay ? " (next day)" : ""}`;
}

// --- PIN pad ---------------------------------------------------------------
let pin = "";
const pinDisplay = document.getElementById("pin-display");

function renderPin() {
  pinDisplay.textContent = "•".repeat(pin.length);
}

document.getElementById("pin-pad").addEventListener("click", (e) => {
  const key = e.target.dataset.key;
  if (!key) return;
  if (key === "clear") pin = "";
  else if (key === "back") pin = pin.slice(0, -1);
  else if (pin.length < 10) pin += key;
  renderPin();
});

document.getElementById("pin-submit").addEventListener("click", async () => {
  const msgEl = document.getElementById("pin-msg");
  msgEl.innerHTML = "";

  if (!staffEmail) {
    msgEl.innerHTML = `<div class="msg error">Config not loaded yet — try again in a moment.</div>`;
    return;
  }
  if (!pin) {
    msgEl.innerHTML = `<div class="msg error">Enter the PIN first.</div>`;
    return;
  }
  // Firebase enforces a 6-character minimum password at account-creation
  // time, so a shorter entry can never be the real PIN — catching this
  // before attempting sign-in gives a distinct, actionable message instead
  // of the same generic "Incorrect PIN" a genuinely-wrong-but-full-length
  // entry would produce, and skips a doomed network round-trip.
  if (pin.length < 6) {
    msgEl.innerHTML = `<div class="msg error">That's too short to be a valid PIN (needs 6+ digits) — check with whoever set it up.</div>`;
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, staffEmail, pin);
    pin = "";
    renderPin();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="msg error">Incorrect PIN${err.code ? ` (${err.code})` : ""}.</div>`;
    pin = "";
    renderPin();
  }
});

document.getElementById("lock-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  document.getElementById("pin-view").style.display = user ? "none" : "block";
  document.getElementById("dashboard-view").style.display = user ? "block" : "none";
  if (user) {
    // Diagnostic: show exactly what email Firebase Auth issued in this
    // session's token, and whether it matches what firestore.rules expects
    // staff to be — this is client-side only (not what the rules actually
    // check server-side), but if these two strings visibly differ, that's
    // the mismatch, without needing devtools to find it.
    const signedInEl = document.getElementById("signed-in-as");
    const matchesConfig = staffEmail && user.email === staffEmail;
    signedInEl.textContent = `Signed in as: ${user.email}${matchesConfig ? "" : " ⚠️ doesn't match configured staff email"}`;
    startSpecialsListener();
    startReservationsListener();
  } else {
    stopSpecialsListener();
    stopReservationsListener();
  }
});

// --- Tabs --------------------------------------------------------------
document.querySelectorAll("#dashboard-view .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#dashboard-view .tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("#dashboard-view .tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.tab}-panel`).classList.add("active");
  });
});

// --- Add Stamp -----------------------------------------------------------
let currentCustomerId = null;

document.getElementById("lookup-btn").addEventListener("click", async () => {
  const lookupMsg = document.getElementById("lookup-msg");
  const resultCard = document.getElementById("customer-result");
  lookupMsg.innerHTML = "";
  resultCard.style.display = "none";
  currentCustomerId = null;

  const value = document.getElementById("lookup-input").value.trim();
  if (!value) {
    lookupMsg.innerHTML = `<div class="msg error">Type an email or phone number first.</div>`;
    return;
  }

  try {
    // Two plain single-field queries instead of one or(email==, phone==)
    // query — simpler and avoids relying on Firestore's OR-query planner.
    let docSnap = null;
    const emailSnap = await getDocs(query(collection(db, "customers"), where("email", "==", value)));
    if (!emailSnap.empty) {
      docSnap = emailSnap.docs[0];
    } else {
      const phoneSnap = await getDocs(query(collection(db, "customers"), where("phone", "==", value)));
      if (!phoneSnap.empty) docSnap = phoneSnap.docs[0];
    }

    if (!docSnap) {
      lookupMsg.innerHTML = `<div class="msg error">No customer found with that email/phone.</div>`;
      return;
    }
    currentCustomerId = docSnap.id;
    renderCustomer(docSnap.data());
    resultCard.style.display = "block";
  } catch (err) {
    console.error(err);
    lookupMsg.innerHTML = `<div class="msg error">Search failed${err.code ? ` (${err.code})` : ""}. Please try again.</div>`;
  }
});

function renderCustomer(data) {
  document.getElementById("result-name").textContent = data.name || "(no name)";
  document.getElementById("result-contact").textContent = [data.email, data.phone].filter(Boolean).join(" · ");
  document.getElementById("result-stamps").textContent = data.stamps || 0;
  document.getElementById("result-required").textContent = stampsRequired;
  const rewards = data.rewardsAvailable || 0;
  document.getElementById("result-rewards").textContent = rewards > 0 ? `🎉 ${rewards} free portion(s) available` : "";
  document.getElementById("redeem-btn").style.display = rewards > 0 ? "block" : "none";
}

document.getElementById("add-stamp-btn").addEventListener("click", async () => {
  if (!currentCustomerId) return;
  const actionMsg = document.getElementById("action-msg");
  actionMsg.innerHTML = "";
  const btn = document.getElementById("add-stamp-btn");
  btn.disabled = true;

  try {
    const custRef = doc(db, "customers", currentCustomerId);
    const updated = await runTransaction(db, async (tx) => {
      const snap = await tx.get(custRef);
      const data = snap.data() || {};
      let stamps = (data.stamps || 0) + 1;
      let rewardsAvailable = data.rewardsAvailable || 0;
      if (stamps >= stampsRequired) {
        stamps = 0;
        rewardsAvailable += 1;
      }
      const next = {
        stamps,
        rewardsAvailable,
        totalStampsEver: (data.totalStampsEver || 0) + 1,
        lastStampAt: serverTimestamp()
      };
      tx.update(custRef, next);
      return { ...data, ...next };
    });
    renderCustomer(updated);
    actionMsg.innerHTML = `<div class="msg success">Stamp added.</div>`;
  } catch (err) {
    console.error(err);
    actionMsg.innerHTML = `<div class="msg error">Couldn't add stamp. Please try again.</div>`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("redeem-btn").addEventListener("click", async () => {
  if (!currentCustomerId) return;
  const actionMsg = document.getElementById("action-msg");
  actionMsg.innerHTML = "";
  const btn = document.getElementById("redeem-btn");
  btn.disabled = true;

  try {
    const custRef = doc(db, "customers", currentCustomerId);
    const updated = await runTransaction(db, async (tx) => {
      const snap = await tx.get(custRef);
      const data = snap.data() || {};
      const rewardsAvailable = data.rewardsAvailable || 0;
      if (rewardsAvailable <= 0) throw new Error("NO_REWARD");
      const next = {
        rewardsAvailable: rewardsAvailable - 1,
        redemptionsCount: (data.redemptionsCount || 0) + 1,
        lastRedeemedAt: serverTimestamp()
      };
      tx.update(custRef, next);
      return { ...data, ...next };
    });
    renderCustomer(updated);
    actionMsg.innerHTML = `<div class="msg success">Reward redeemed — enjoy!</div>`;
  } catch (err) {
    console.error(err);
    actionMsg.innerHTML = `<div class="msg error">Couldn't redeem. Please try again.</div>`;
  } finally {
    btn.disabled = false;
  }
});

// --- Specials editor -------------------------------------------------------
let unsubSpecials = null;

function startSpecialsListener() {
  const listEl = document.getElementById("specials-list");
  const q = query(collection(db, "specials"), orderBy("order", "desc"));
  unsubSpecials = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p class="hint">No specials added yet.</p>`;
      return;
    }
    listEl.innerHTML = snap.docs
      .map((d) => {
        const s = d.data();
        const isToday = s.date && s.date === todayISO();
        return `
        <div class="card">
          <span class="badge" style="background:${s.active ? "var(--color-accent)" : "var(--color-border)"}; color:${s.active ? "#fff" : "var(--color-text)"};">${s.active ? "Live" : "Hidden"}</span>
          ${isToday ? `<span class="badge" style="background:#000;">Today</span>` : ""}
          <h3>${escapeHtml(s.title)}</h3>
          <p>${escapeHtml(s.description)}</p>
          ${s.weekLabel ? `<p class="hint">${escapeHtml(s.weekLabel)}</p>` : ""}
          ${s.date ? `<p class="hint">Date: ${escapeHtml(s.date)}</p>` : ""}
          <div style="display:flex; gap:8px;">
            <button class="btn secondary small" data-action="toggle" data-id="${d.id}" data-active="${s.active}">${s.active ? "Hide" : "Show"}</button>
            <button class="btn secondary small" data-action="delete" data-id="${d.id}">Delete</button>
          </div>
        </div>`;
      })
      .join("");
  });
}

function stopSpecialsListener() {
  if (unsubSpecials) { unsubSpecials(); unsubSpecials = null; }
}

document.getElementById("specials-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "toggle") {
    await updateDoc(doc(db, "specials", id), { active: !(btn.dataset.active === "true") });
  } else if (btn.dataset.action === "delete") {
    if (confirm("Delete this special?")) {
      await deleteDoc(doc(db, "specials", id));
    }
  }
});

document.getElementById("add-special-btn").addEventListener("click", async () => {
  const msgEl = document.getElementById("special-msg");
  msgEl.innerHTML = "";
  const title = document.getElementById("new-title").value.trim();
  const description = document.getElementById("new-desc").value.trim();
  const weekLabel = document.getElementById("new-week").value.trim();
  const date = document.getElementById("new-date").value;

  if (!title || !description) {
    msgEl.innerHTML = `<div class="msg error">Title and description are required.</div>`;
    return;
  }

  try {
    await addDoc(collection(db, "specials"), {
      title,
      description,
      weekLabel: weekLabel || null,
      date: date || null,
      active: true,
      order: Date.now(),
      updatedAt: serverTimestamp()
    });
    document.getElementById("new-title").value = "";
    document.getElementById("new-desc").value = "";
    document.getElementById("new-week").value = "";
    document.getElementById("new-date").value = "";
    msgEl.innerHTML = `<div class="msg success">Added.</div>`;
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="msg error">Couldn't add — please try again.</div>`;
  }
});

// --- Reservations list -------------------------------------------------
let unsubReservations = null;

function startReservationsListener() {
  const listEl = document.getElementById("reservations-list");
  const q = query(
    collection(db, "reservations"),
    where("date", ">=", todayISO()),
    orderBy("date", "asc")
  );
  unsubReservations = onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        listEl.innerHTML = `<p class="hint">No upcoming reservations.</p>`;
        return;
      }
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

      listEl.innerHTML = `
        <div class="card" style="padding:0;">
          ${rows
            .map(
              (r) => `
            <div class="list-item" style="padding:14px;">
              <div>
                <strong>${escapeHtml(r.date)} · ${escapeHtml(formatTimeLabel(r.time))}</strong><br/>
                ${escapeHtml(r.name)} — party of ${r.partySize}<br/>
                <span class="hint">${escapeHtml(r.phone || "")} ${r.email ? "· " + escapeHtml(r.email) : ""}</span>
                ${r.notes ? `<br/><span class="hint">Note: ${escapeHtml(r.notes)}</span>` : ""}
              </div>
              <span class="badge">${escapeHtml(r.status || "confirmed")}</span>
            </div>`
            )
            .join("")}
        </div>`;
    },
    (err) => {
      console.error(err);
      listEl.innerHTML = `<div class="msg error">Couldn't load reservations.</div>`;
    }
  );
}

function stopReservationsListener() {
  if (unsubReservations) { unsubReservations(); unsubReservations = null; }
}
