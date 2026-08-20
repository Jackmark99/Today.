const CACHE_NAME = "planning-comptoir-v3";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {}));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
