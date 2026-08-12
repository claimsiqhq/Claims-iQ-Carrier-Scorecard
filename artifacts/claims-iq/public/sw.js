const CACHE_NAME = "complete-iq-v4";
const scopeUrl = new URL(self.registration.scope);
const scoped = (path) => new URL(path, scopeUrl).toString();
const STATIC_ASSETS = [
  scoped("./"),
  scoped("manifest.json"),
  scoped("favicon.png"),
  scoped("icons/icon-192.png"),
  scoped("icons/icon-512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  const apiPath = `${scopeUrl.pathname.replace(/\/$/, "")}/api/`;
  if (url.origin !== self.location.origin || url.pathname.startsWith(apiPath)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(scoped("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
