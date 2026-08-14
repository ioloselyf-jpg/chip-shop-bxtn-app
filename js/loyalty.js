import { auth, db, applyTheme, loadSiteConfig } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

applyTheme();

let stampsRequired = 8; // overwritten from config once loaded
loadSiteConfig().then((cfg) => {
  if (cfg?.loyalty?.stampsRequired) stampsRequired = cfg.loyalty.stampsRequired;
  document.getElementById("stamps-required-1").textContent = stampsRequired;
});

// --- Tab switching -----------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.tab}-panel`).classList.add("active");
  });
});

function showMsg(elId, text, type = "error") {
  const el = document.getElementById(elId);
  el.innerHTML = text ? `<div class="msg ${type}">${text}</div>` : "";
}

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "That email already has an account — try logging in instead.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Incorrect email or password.";
  }
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("invalid-email")) return "That doesn't look like a valid email address.";
  return "Something went wrong. Please try again.";
}

// --- Sign up -------------------------------------------------------------
document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("signup-msg", "");
  const name = document.getElementById("signup-name").value.trim();
  const phone = document.getElementById("signup-phone").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "customers", cred.user.uid), {
      name,
      nameLower: name.toLowerCase(),
      phone: phone || null,
      email,
      stamps: 0,
      rewardsAvailable: 0,
      totalStampsEver: 0,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    showMsg("signup-msg", friendlyAuthError(err));
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Log in ---------------------------------------------------------------
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("login-msg", "");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    showMsg("login-msg", friendlyAuthError(err));
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById("signout-btn").addEventListener("click", () => signOut(auth));

// --- Card view --------------------------------------------------------
let unsubscribeCustomer = null;

function renderCard(data) {
  document.getElementById("customer-name").textContent = data.name || "there";

  const stamps = data.stamps || 0;
  const grid = document.getElementById("stamp-grid");
  grid.innerHTML = "";
  for (let i = 0; i < stampsRequired; i++) {
    const cell = document.createElement("div");
    cell.className = "stamp" + (i < stamps ? " filled" : "");
    cell.textContent = i < stamps ? "🍟" : "";
    grid.appendChild(cell);
  }

  const remaining = Math.max(stampsRequired - stamps, 0);
  document.getElementById("progress-text").textContent =
    remaining === 0
      ? "Your next stamp earns a pint of Chip Shop Lager!"
      : `${remaining} more stamp${remaining === 1 ? "" : "s"} until your pint of Chip Shop Lager.`;

  const rewardBanner = document.getElementById("reward-banner");
  const rewards = data.rewardsAvailable || 0;
  rewardBanner.innerHTML =
    rewards > 0
      ? `<div class="reward-banner">🎉 You have ${rewards} pint${rewards > 1 ? "s" : ""} of Chip Shop Lager waiting! Show this screen to staff at the counter.</div>`
      : "";
}

onAuthStateChanged(auth, (user) => {
  if (unsubscribeCustomer) {
    unsubscribeCustomer();
    unsubscribeCustomer = null;
  }

  if (user) {
    document.getElementById("auth-forms").style.display = "none";
    document.getElementById("card-view").style.display = "block";
    unsubscribeCustomer = onSnapshot(doc(db, "customers", user.uid), (snap) => {
      if (snap.exists()) renderCard(snap.data());
    });
  } else {
    document.getElementById("auth-forms").style.display = "block";
    document.getElementById("card-view").style.display = "none";
  }
});
