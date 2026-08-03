/**
 * Service worker: the offline shell.
 *
 * WHAT THIS DOES AND DOES NOT CACHE
 *
 * It caches the app shell — HTML, JS, CSS, fonts — so a returning player gets a
 * screen instantly instead of a white page while the bundle downloads, and so a
 * dropped connection shows the app with an error rather than the browser's
 * dinosaur.
 *
 * It NEVER caches API responses. A cached balance is a wrong balance, and a
 * cached bet result is a bet that appears to have happened twice. Every request
 * to the API goes to the network or fails honestly.
 */

const VERSION = 'juwa-v1';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that looks like the API is network-only. Never serve a stale
  // balance, a stale round, or a stale anything a player might act on.
  const isApi =
    url.pathname.startsWith('/bet') ||
    url.pathname.startsWith('/act') ||
    url.pathname.startsWith('/balance') ||
    url.pathname.startsWith('/bonus') ||
    url.pathname.startsWith('/register') ||
    url.pathname.startsWith('/me') ||
    url.pathname.startsWith('/verify') ||
    url.origin !== self.location.origin;
  if (isApi) return;

  // Navigations: try the network so a deploy is picked up, fall back to the
  // cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Static assets are content-hashed by the bundler, so a cache hit is always
  // the right file and can be served immediately.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
