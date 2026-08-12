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

  /*
   * ART AND AUDIO ARE NOT CONTENT-HASHED, AND THAT CHANGES THE RULE.
   *
   * The bundler fingerprints its own output — `entry-8fa31c.js` — so a cache
   * hit on a bundle asset is always the right file and serving it from cache
   * forever is correct.
   *
   * `art/` and `audio/` are copied verbatim by `finalize-web.mjs`, so their
   * URLs never change. Under a plain cache-first rule that means a file cached
   * once is served forever: the day a symbol is redrawn, a badge is cleaned off
   * a dragon, or a bed is replaced, every returning player keeps the old one
   * indefinitely and no redeploy can reach them. That is not hypothetical —
   * `dragon-original-main.png` and `dragon-wing-near.png` were both edited in
   * place after they had already been served once.
   *
   * Stale-while-revalidate is the right trade for these. The cached copy is
   * served immediately, so the app stays fast and still works offline, and the
   * network copy is fetched in the background and replaces it — so the change
   * lands on the next visit rather than never.
   */
  const versioned = !/^\/(art|audio)\//.test(url.pathname);

  event.respondWith(
    caches.match(request).then((hit) => {
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        // Offline with nothing cached is a genuine failure; offline WITH
        // something cached has already been answered above.
        .catch(() => hit || Response.error());

      if (!hit) return fromNetwork;
      if (versioned) return hit;

      // Revalidate in the background; the player still gets the cached file
      // now. `void` because nothing waits on it.
      void fromNetwork;
      return hit;
    }),
  );
});
