// Chanje nimewo sa a CHAK FWA ou fè yon deplwaman enpòtan —
// sa fòse tout ansyen "worker" yo efase e mete ajou otomatikman.
const CACHE_NAME = "millionstore-v2";
const urlsToCache = ["/", "/login", "/mon-compte"];

// ── INSTALL ── mete cache initial la, epi pran kontwòl imedyatman
self.addEventListener("install", (event) => {
  self.skipWaiting(); // pa tann — aktive nouvo vèsyon an touswit
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// ── ACTIVATE ── siprime TOUT ansyen cache ki pa menm ak vèsyon aktyèl la
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim()) // pran kontwòl tout paj ki louvri deja
  );
});

// ── FETCH ── estrateji "network-first": toujou eseye chèche nouvo vèsyon
// sou sèvè a anvan; sèvi ak cache a SÈLMAN si pa gen entènèt
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Sove nouvo vèsyon an nan cache pou lè li pa gen entènèt
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request)) // offline → sèvi ak cache
  );
});