const CACHE_NAME = "sales-system-v2";

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./offline-storage.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_FILES)
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith("sales-system-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // لا نخزن أي طلبات تخص Supabase
  if (url.hostname.includes("supabase.co")) return;

  // لا نخزن إلا ملفات التطبيق من نفس الموقع
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request);
    })
  );
});
