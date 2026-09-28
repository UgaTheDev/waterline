// Waterline app-shell + snapshot cache. Vanilla service worker, no build step and no dependencies:
// Next.js chunk names are hashed at build time, so there's no static list to precache. Instead this
// caches same-origin GETs opportunistically as they're fetched (the page shell, the snapshot json
// under /snapshot/, icons, manifest), so a reload works offline once the app has been opened once.
// It never touches the live backend: that's cross-origin (NEXT_PUBLIC_API_URL), and the fetch
// handler below only ever intercepts requests to this app's own origin.
const CACHE = "waterline-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return; // let the browser handle the API + everything cross-origin

  if (req.mode === "navigate") {
    // Network-first for the page itself, so content updates as soon as we're back online.
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  // Cache-first for everything else (JS/CSS chunks, snapshot json, icons): fast, and works offline
  // once visited once.
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        }),
    ),
  );
});
