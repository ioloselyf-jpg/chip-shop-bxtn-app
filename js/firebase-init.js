// Shared Firebase bootstrap used by every page. Loaded as an ES module.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {
  // Non-fatal — falls back to default persistence.
});

let configPromise = null;

// Fetches config/site-config.json once and caches it for the page's lifetime.
export function loadSiteConfig() {
  if (!configPromise) {
    configPromise = fetch("config/site-config.json")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load site-config.json");
        return res.json();
      })
      .catch((err) => {
        console.error(err);
        return null;
      });
  }
  return configPromise;
}

// Applies theme.* colors from site-config.json as CSS variables, and fills
// in any element with [data-shop-name] / [data-tagline]. Call once per page.
export async function applyTheme() {
  const config = await loadSiteConfig();
  if (!config) return config;

  const root = document.documentElement;
  const theme = config.theme || {};
  if (theme.primaryColor) root.style.setProperty("--color-primary", theme.primaryColor);
  if (theme.primaryColorDark) root.style.setProperty("--color-primary-dark", theme.primaryColorDark);
  if (theme.accentColor) root.style.setProperty("--color-accent", theme.accentColor);

  // --color-bg/--color-text are the two variables style.css flips for dark
  // mode via @media (prefers-color-scheme: dark). Inline styles always beat
  // a stylesheet's media-query rule for the same property, so setting these
  // unconditionally here would permanently force light-mode colors onto
  // dark-mode users — which is exactly what made the staff.html PIN pad
  // render near-invisible (dark text forced onto a dark background). Only
  // apply the config's light-mode colors when the browser isn't in dark
  // mode; otherwise let style.css's dark palette stand.
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  if (!prefersDark) {
    if (theme.backgroundColor) root.style.setProperty("--color-bg", theme.backgroundColor);
    if (theme.textColor) root.style.setProperty("--color-text", theme.textColor);
  }

  document.querySelectorAll("[data-shop-name]").forEach((el) => {
    el.textContent = theme.logoText || config.shopName || el.textContent;
  });
  document.querySelectorAll("[data-tagline]").forEach((el) => {
    el.textContent = config.tagline || el.textContent;
  });
  if (config.shopName) {
    document.title = document.title.replace("Chip Shop Bxtn", config.shopName);
  }

  return config;
}
