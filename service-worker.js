const CACHE_NAME = "sales-system-v37";
const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./offline-storage.js",
  "./supabase.js",
  "./icon-192.png",
  "./icon-512.png"
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
          .filter(key =>
            key.startsWith("sales-system-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  if (url.hostname.includes("supabase.co")) return;

  if (url.origin !== self.location.origin) return;

  event.respondWith(
  fetch(request)
    .then(response => {
      if (response && response.ok) {
        const copy = response.clone();

        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, copy);
        });
      }

      return response;
    })
    .catch(async () => {
      const cached = await caches.match(request, {
        ignoreSearch: true
      });

      if (cached) return cached;

      return new Response("لا يوجد اتصال بالإنترنت ولا توجد نسخة محفوظة.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    })
);
});
