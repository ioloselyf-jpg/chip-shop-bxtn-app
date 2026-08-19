// Bump this whenever you deploy changes to shell files below — it forces
// clients to fetch fresh copies instead of serving stale cached versions.
const CACHE_VERSION = "v17";
const CACHE_NAME = `chip-shop-shell-${CACHE_VERSION}`;

const SHELL_FILES = [
  "/index.html",
  "/whats-on.html",
  "/loyalty.html",
  "/reserve.html",
  "/about.html",
  "/djs.html",
  "/staff.html",
  "/offline.html",
  "/manifest.json",
  "/css/style.css",
  "/js/firebase-config.js",
  "/js/firebase-init.js",
  "/js/whats-on.js",
  "/js/loyalty.js",
  "/js/reserve.js",
  "/js/staff.js",
  "/js/djs.js",
  "/config/site-config.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/logo.png",
  "/fonts/Anton-Regular.woff2",
  "/images/hero-home.webp",
  "/images/hero-whats-on.webp",
  "/images/hero-loyalty.webp",
  "/images/hero-reserve.webp",
  "/images/djs/dj-shorty.jpg",
  "/images/djs/jim-sharp.jpg",
  "/images/djs/dj-wally-puma.jpg",
  "/images/djs/dj-dave-lazy.jpg",
  "/images/djs/dj-outbreak.jpg",
  "/images/djs/unique-hastings.jpg",
  "/images/djs/asian-hawk.jpg",
  "/images/djs/fraggle.jpg",
  "/images/djs/dj-rumz.jpg",
  "/images/djs/rapture.png",
  "/images/djs/zia.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests — let Firebase/Firestore/auth
  // network calls pass straight through untouched.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("/offline.html");
        return Response.error();
      })
  );
});
