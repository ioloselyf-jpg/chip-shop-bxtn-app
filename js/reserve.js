import { db, applyTheme, loadSiteConfig } from "./firebase-init.js";
import {
  doc,
  collection,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

applyTheme();

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const dateInput = document.getElementById("res-date");
const timeSelect = document.getElementById("res-time");
const partySelect = document.getElementById("res-party");
const form = document.getElementById("reserve-form");
const msgEl = document.getElementById("reserve-msg");

let config = null;

function pad(n) { return String(n).padStart(2, "0"); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(baseISO, days) {
  const d = new Date(`${baseISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Accepts minute-of-day values that may exceed 1440 (used for slots that
// fall after midnight on an overnight session, e.g. Fri/Sat closing at
// 01:00) and displays them as a normal wall-clock time, flagged "next day".
function minutesToLabel(mins) {
  const isNextDay = mins >= 1440;
  const normalized = ((mins % 1440) + 1440) % 1440;
  let h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad(m)} ${ampm}${isNextDay ? " (next day)" : ""}`;
}

// "HH:MM" here may have an hour part >= 24 (e.g. "24:30") for overnight
// slots — that's deliberate, see resolveHours()/populateTimeSlots() below.
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Looks up the opening hours for a specific calendar date: an exact
// dateOverrides entry (for one-off events on normally-closed days, or
// closing a normally-open day) takes priority over the day-of-week default.
function resolveHours(selectedDate, resCfg) {
  const override = resCfg.dateOverrides?.[selectedDate];
  if (override) return override;
  const dayKey = DAY_KEYS[new Date(`${selectedDate}T00:00:00`).getDay()];
  return resCfg.openingHours?.[dayKey];
}

function showMsg(text, type = "error") {
  msgEl.innerHTML = text ? `<div class="msg ${type}">${text}</div>` : "";
}

function populatePartySizes() {
  const max = config?.reservations?.maxPartySize || 20;
  partySelect.innerHTML = "";
  for (let i = 1; i <= max; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = i === 1 ? "1 person" : `${i} people`;
    partySelect.appendChild(opt);
  }
}

function populateTimeSlots() {
  timeSelect.innerHTML = "";
  const selectedDate = dateInput.value;
  if (!selectedDate) {
    timeSelect.disabled = true;
    timeSelect.innerHTML = `<option value="">Choose a date first</option>`;
    return;
  }

  const resCfg = config?.reservations || {};
  const hours = resolveHours(selectedDate, resCfg);

  if (!hours || hours.closed) {
    timeSelect.disabled = true;
    timeSelect.innerHTML = `<option value="">Closed this day</option>`;
    return;
  }

  const interval = resCfg.slotIntervalMinutes || 30;
  const buffer = resCfg.lastSeatingBufferMinutes ?? interval;
  const openMins = timeToMinutes(hours.open);
  // overnight: true means "close" is a time after midnight the next day
  // (e.g. Fri/Sat closing at 01:00) — add a full day so the slot loop below
  // keeps counting past midnight instead of wrapping back to 0.
  const closeMins = timeToMinutes(hours.close) + (hours.overnight ? 1440 : 0);
  const lastSlot = closeMins - buffer;

  const isToday = selectedDate === todayISO();
  const leadTime = resCfg.leadTimeMinutes ?? 0;
  const now = new Date();
  const earliestMinsToday = now.getHours() * 60 + now.getMinutes() + leadTime;

  const options = [];
  for (let t = openMins; t <= lastSlot; t += interval) {
    if (isToday && t < earliestMinsToday) continue;
    options.push(t);
  }

  if (options.length === 0) {
    timeSelect.disabled = true;
    timeSelect.innerHTML = `<option value="">No slots left today</option>`;
    return;
  }

  timeSelect.disabled = false;
  timeSelect.innerHTML = `<option value="">Select a time</option>` + options
    .map((t) => `<option value="${pad(Math.floor(t / 60))}:${pad(t % 60)}">${minutesToLabel(t)}</option>`)
    .join("");
}

loadSiteConfig().then((cfg) => {
  config = cfg || {};
  const resCfg = config.reservations || {};
  const today = todayISO();
  dateInput.min = today;
  dateInput.max = addDaysISO(today, resCfg.maxAdvanceBookingDays ?? 30);
  dateInput.value = today;

  populatePartySizes();
  populateTimeSlots();
});

dateInput.addEventListener("change", populateTimeSlots);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("");

  const date = dateInput.value;
  const time = timeSelect.value;
  const partySize = Number(partySelect.value);
  const name = document.getElementById("res-name").value.trim();
  const phone = document.getElementById("res-phone").value.trim();
  const email = document.getElementById("res-email").value.trim();
  const notes = document.getElementById("res-notes").value.trim();

  if (!date || !time) {
    showMsg("Please choose a date and time.");
    return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const capacity = config?.reservations?.capacityPerSlotCovers || 20;
  const slotKey = `${date}_${time}`;

  try {
    await runTransaction(db, async (tx) => {
      const slotRef = doc(db, "slotCounts", slotKey);
      const slotSnap = await tx.get(slotRef);
      const currentCovers = slotSnap.exists() ? (slotSnap.data().covers || 0) : 0;

      if (currentCovers + partySize > capacity) {
        throw new Error("SLOT_FULL");
      }

      const reservationRef = doc(collection(db, "reservations"));
      tx.set(slotRef, { date, time, covers: currentCovers + partySize }, { merge: true });
      tx.set(reservationRef, {
        name,
        phone,
        email,
        partySize,
        date,
        time,
        notes: notes || null,
        status: "confirmed",
        createdAt: serverTimestamp()
      });
    });

    document.getElementById("booking-view").style.display = "none";
    const confirmView = document.getElementById("confirmation-view");
    confirmView.style.display = "block";
    document.getElementById("confirmation-text").textContent =
      `Table for ${partySize} on ${date} at ${minutesToLabel(timeToMinutes(time))}, under the name ${name}.`;

    // Best-effort confirmation/alert emails — the booking above is already
    // committed and "confirmed" by this point. This call is fire-and-forget
    // on purpose: a slow, down, or not-yet-configured email provider must
    // never make a successful booking look like it failed. Runs on a
    // separate Cloudflare Worker (cross-origin from this static site) —
    // see cloudflare/send-reservation-emails/. emailWorkerUrl is blank
    // until that Worker is deployed and its URL is filled into
    // config/site-config.json, so skip the call entirely rather than
    // fetching an empty URL.
    const emailWorkerUrl = config?.reservations?.emailWorkerUrl;
    if (emailWorkerUrl) {
      fetch(emailWorkerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, partySize, date, time, notes: notes || null })
      }).catch((err) => console.error("Reservation email request failed:", err));
    }
  } catch (err) {
    console.error(err);
    if (err.message === "SLOT_FULL") {
      showMsg("Sorry, that time just filled up — please choose another slot.");
      populateTimeSlots();
    } else {
      showMsg("Something went wrong making your booking. Please try again.");
    }
  } finally {
    submitBtn.disabled = false;
  }
});
