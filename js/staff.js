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
  limit,
  getDoc,
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
    startDjsListener();
    startReservationsListener();
  } else {
    stopSpecialsListener();
    stopDjsListener();
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

function selectCustomer(id, data) {
  searchToken++; // invalidate any in-flight name search so a late result can't overwrite this selection
  document.getElementById("name-results").innerHTML = "";
  document.getElementById("lookup-msg").innerHTML = "";
  currentCustomerId = id;
  renderCustomer(data);
  document.getElementById("customer-result").style.display = "block";
  loadActivity(id);
}

// --- Loyalty audit log ("Recent activity") --------------------------------
// Equality-only filter (customerId) with no orderBy — a composite index
// would be needed to combine where(customerId==) with orderBy(timestamp),
// same trap documented for whats-on.js/reservations elsewhere in this app.
// Instead: fetch every event for this customer (loyaltyEvents is small per
// customer — a handful of stamps/redemptions, not thousands) and sort/trim
// to the most recent 10 client-side, so "last 10" is actually accurate
// rather than an arbitrary unordered 10 a server-side limit() would give.
async function loadActivity(customerId) {
  const activityEl = document.getElementById("activity-list");
  activityEl.innerHTML = `<div class="spinner"></div>`;
  try {
    const snap = await getDocs(query(collection(db, "loyaltyEvents"), where("customerId", "==", customerId)));
    if (snap.empty) {
      activityEl.innerHTML = `<p class="hint">No activity yet.</p>`;
      return;
    }
    const events = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0))
      .slice(0, 10);

    activityEl.innerHTML = events
      .map((e) => {
        const when = e.timestamp?.toDate ? e.timestamp.toDate().toLocaleString() : "just now";
        const label = e.type === "redeem" ? "Reward redeemed" : "Stamp added";
        return `
        <div class="list-item">
          <span>${escapeHtml(label)}</span>
          <span class="hint">${escapeHtml(e.staffEmail || "unknown staff")} · ${escapeHtml(when)}</span>
        </div>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    activityEl.innerHTML = `<div class="msg error">Couldn't load activity${err.code ? ` (${err.code})` : ""}.</div>`;
  }
}

// Live, as-you-type prefix search by name. Firestore has no native substring
// search, but a range query on a lowercased field gives prefix matching:
// nameLower in [prefix, prefix + '\uF8FF') catches every string that starts
// with prefix, since U+F8FF sorts after any realistic name character. Single
// field, two inequality bounds on that same field — no orderBy needed and no
// composite index required (unlike the whats-on/reservations queries
// elsewhere, which deliberately avoid combining where+orderBy for the same
// reason).
const nameResultsEl = document.getElementById("name-results");
let searchDebounceTimer = null;
let searchToken = 0;

document.getElementById("lookup-input").addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  const raw = e.target.value.trim();
  if (!raw) {
    // Bump the token too, not just clear the pending timer — a search that
    // already fired and is mid-flight (awaiting getDocs) isn't touched by
    // clearTimeout, and without this its stale result would otherwise land
    // and overwrite this empty state once it resolves.
    searchToken++;
    nameResultsEl.innerHTML = "";
    return;
  }
  searchDebounceTimer = setTimeout(() => runNameSearch(raw), 250);
});

async function runNameSearch(raw) {
  const prefix = raw.toLowerCase();
  const thisSearch = ++searchToken;
  try {
    const snap = await getDocs(
      query(
        collection(db, "customers"),
        where("nameLower", ">=", prefix),
        where("nameLower", "<", prefix + "\uF8FF"),
        limit(8)
      )
    );
    if (thisSearch !== searchToken) return; // a newer keystroke's search has already landed

    if (snap.empty) {
      nameResultsEl.innerHTML = `<p class="hint">No matching names.</p>`;
      return;
    }
    const matches = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nameLower || "").localeCompare(b.nameLower || ""));

    nameResultsEl.innerHTML = matches
      .map(
        (m) => `
      <button type="button" class="name-result-item" data-id="${m.id}">
        <span>${escapeHtml(m.name || "(no name)")}</span>
        <span class="contact">${escapeHtml([m.email, m.phone].filter(Boolean).join(" · "))}</span>
      </button>`
      )
      .join("");

    nameResultsEl.querySelectorAll(".name-result-item").forEach((btn, i) => {
      btn.addEventListener("click", () => selectCustomer(matches[i].id, matches[i]));
    });
  } catch (err) {
    if (thisSearch !== searchToken) return;
    console.error(err);
    nameResultsEl.innerHTML = `<div class="msg error">Name search failed${err.code ? ` (${err.code})` : ""}.</div>`;
  }
}

// Exact email/phone lookup — kept as a fallback for when a guest's stamp
// card was created before the name-search rollout, or when it's faster to
// just type a known email/phone directly.
document.getElementById("lookup-btn").addEventListener("click", async () => {
  const lookupMsg = document.getElementById("lookup-msg");
  const resultCard = document.getElementById("customer-result");
  searchToken++; // invalidate any in-flight name search so a late result can't overwrite this
  lookupMsg.innerHTML = "";
  nameResultsEl.innerHTML = "";
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
    selectCustomer(docSnap.id, docSnap.data());
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
  document.getElementById("result-rewards").textContent = rewards > 0 ? `🎉 ${rewards} pint(s) of Chip Shop Lager available` : "";
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
    // Auto-ID generated client-side (no network round-trip), so it can be
    // used with tx.set() inside the transaction below — addDoc() isn't
    // transaction-safe, but a pre-made ref + tx.set() is.
    const eventRef = doc(collection(db, "loyaltyEvents"));
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
      tx.set(eventRef, {
        customerId: currentCustomerId,
        customerName: data.name || null,
        type: "stamp",
        staffEmail: auth.currentUser?.email || null,
        stampsAfter: stamps,
        rewardsAfter: rewardsAvailable,
        timestamp: serverTimestamp()
      });
      return { ...data, ...next };
    });
    renderCustomer(updated);
    actionMsg.innerHTML = `<div class="msg success">Stamp added.</div>`;
    loadActivity(currentCustomerId);
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
    const eventRef = doc(collection(db, "loyaltyEvents"));
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
      tx.set(eventRef, {
        customerId: currentCustomerId,
        customerName: data.name || null,
        type: "redeem",
        staffEmail: auth.currentUser?.email || null,
        stampsAfter: data.stamps || 0,
        rewardsAfter: next.rewardsAvailable,
        timestamp: serverTimestamp()
      });
      return { ...data, ...next };
    });
    renderCustomer(updated);
    actionMsg.innerHTML = `<div class="msg success">Reward redeemed — enjoy!</div>`;
    loadActivity(currentCustomerId);
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

// --- Resident DJs editor ----------------------------------------------
// Same list/toggle/delete pattern as the specials editor above, plus Edit
// (which specials doesn't have): rather than a separate form, editing
// re-uses the same Add form — populate it from the selected DJ, flip the
// heading/button text, and branch addDoc vs updateDoc on save. Keeps one
// form to maintain instead of two near-identical ones.
let unsubDjs = null;
let editingDjId = null;

function startDjsListener() {
  const listEl = document.getElementById("djs-list");
  // Single-field orderBy, no where() alongside it — no composite index
  // needed, same reasoning as the specials listener above. Ascending here
  // (not desc like specials) because a DJ's `order` is a deliberately
  // curated lineup position, not a "newest first" timestamp.
  const q = query(collection(db, "djs"), orderBy("order", "asc"));
  unsubDjs = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p class="hint">No resident DJs added yet.</p>`;
      return;
    }
    listEl.innerHTML = snap.docs
      .map((d) => {
        const dj = d.data();
        const dates = Array.isArray(dj.upcomingDates) ? dj.upcomingDates : [];
        return `
        <div class="card">
          <span class="badge" style="background:${dj.active ? "var(--color-accent)" : "var(--color-border)"}; color:${dj.active ? "#fff" : "var(--color-text)"};">${dj.active ? "Live" : "Hidden"}</span>
          <h3>${escapeHtml(dj.name)}</h3>
          ${dj.bio ? `<p>${escapeHtml(dj.bio)}</p>` : ""}
          <p class="hint">Order: ${dj.order ?? 0} · ${dj.photoUrl ? "Photo set" : "No photo set"}</p>
          ${dates.length ? `<p class="hint">Dates: ${escapeHtml(dates.join(", "))}</p>` : ""}
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn secondary small" data-action="edit" data-id="${d.id}">Edit</button>
            <button class="btn secondary small" data-action="toggle" data-id="${d.id}" data-active="${dj.active}">${dj.active ? "Hide" : "Show"}</button>
            <button class="btn secondary small" data-action="delete" data-id="${d.id}">Delete</button>
          </div>
        </div>`;
      })
      .join("");
  });
}

function stopDjsListener() {
  if (unsubDjs) { unsubDjs(); unsubDjs = null; }
}

function fillDjForm(dj) {
  document.getElementById("new-dj-name").value = dj.name || "";
  document.getElementById("new-dj-bio").value = dj.bio || "";
  document.getElementById("new-dj-photo").value = dj.photoUrl || "";
  document.getElementById("new-dj-dates").value = Array.isArray(dj.upcomingDates) ? dj.upcomingDates.join(", ") : "";
  document.getElementById("new-dj-order").value = dj.order ?? "";
}

function clearDjForm() {
  document.getElementById("new-dj-name").value = "";
  document.getElementById("new-dj-bio").value = "";
  document.getElementById("new-dj-photo").value = "";
  document.getElementById("new-dj-dates").value = "";
  document.getElementById("new-dj-order").value = "";
}

function setDjEditMode(id, dj) {
  editingDjId = id;
  fillDjForm(dj);
  document.getElementById("dj-form-heading").textContent = `Edit ${dj.name}`;
  document.getElementById("add-dj-btn").textContent = "Save changes";
  document.getElementById("cancel-dj-edit-btn").style.display = "block";
  document.getElementById("dj-msg").innerHTML = "";
}

function exitDjEditMode() {
  editingDjId = null;
  clearDjForm();
  document.getElementById("dj-form-heading").textContent = "Add a resident DJ";
  document.getElementById("add-dj-btn").textContent = "Add DJ";
  document.getElementById("cancel-dj-edit-btn").style.display = "none";
}

document.getElementById("cancel-dj-edit-btn").addEventListener("click", exitDjEditMode);

document.getElementById("djs-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "toggle") {
    await updateDoc(doc(db, "djs", id), { active: !(btn.dataset.active === "true") });
  } else if (btn.dataset.action === "delete") {
    if (confirm("Delete this DJ?")) {
      if (editingDjId === id) exitDjEditMode();
      await deleteDoc(doc(db, "djs", id));
    }
  } else if (btn.dataset.action === "edit") {
    const snap = await getDoc(doc(db, "djs", id));
    if (snap.exists()) setDjEditMode(id, snap.data());
  }
});

document.getElementById("add-dj-btn").addEventListener("click", async () => {
  const msgEl = document.getElementById("dj-msg");
  msgEl.innerHTML = "";
  const name = document.getElementById("new-dj-name").value.trim();
  const bio = document.getElementById("new-dj-bio").value.trim();
  const photoUrl = document.getElementById("new-dj-photo").value.trim();
  const datesRaw = document.getElementById("new-dj-dates").value.trim();
  const orderRaw = document.getElementById("new-dj-order").value;

  if (!name) {
    msgEl.innerHTML = `<div class="msg error">Name is required.</div>`;
    return;
  }

  // Comma-separated "YYYY-MM-DD, YYYY-MM-DD" -> array, dropping blanks from
  // stray commas/whitespace. Not validated against the real calendar (e.g.
  // "2026-13-40" would pass) — same level of trust the specials date field
  // already gets elsewhere in this app.
  const upcomingDates = datesRaw
    ? datesRaw.split(",").map((d) => d.trim()).filter(Boolean)
    : [];

  const payload = {
    name,
    bio: bio || null,
    photoUrl: photoUrl || null,
    upcomingDates,
    order: orderRaw !== "" ? Number(orderRaw) : Date.now(),
    updatedAt: serverTimestamp()
  };

  try {
    if (editingDjId) {
      await updateDoc(doc(db, "djs", editingDjId), payload);
      msgEl.innerHTML = `<div class="msg success">Saved.</div>`;
      exitDjEditMode();
    } else {
      await addDoc(collection(db, "djs"), { ...payload, active: true });
      clearDjForm();
      msgEl.innerHTML = `<div class="msg success">Added.</div>`;
    }
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="msg error">Couldn't save — please try again.</div>`;
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
