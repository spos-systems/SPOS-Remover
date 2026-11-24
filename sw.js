/* SPOS Remover v1.5.0 service worker — installable PWA with offline app shell.
 *
 * Strategy:
 *   • Precache the app shell (HTML, CSS, JS, fonts, icons, manifest) —
 *     INCLUDING the vendored AI engine (assets/vendor/…), so the engine
 *     itself is offline after first load.
 *   • Navigations AND code assets (CSS/JS): NETWORK-FIRST — a fresh deploy
 *     is what the user sees on the very next visit; the cache is only the
 *     offline fallback.
 *   • Fonts, images, the VENDORED ENGINE (/assets/vendor/…) and the
 *     SELF-HOSTED AI MODEL CHUNKS (/assets/models/…): cache-first
 *     (immutable, content-hashed files), so background removal keeps
 *     working fully offline after first use.
 *   • imgly data CDN (staticimgly.com — the “max accuracy” model): cache-first
 *     for CORS responses so the tier the user prewarms also becomes offline
 *     capable; opaque responses are never cached (unreadable).
 *   • Model chunks get an in-SW RETRY loop (3 attempts, growing backoff):
 *     on flaky mobile networks a single dropped chunk no longer kills a
 *     download — the chunk is re-fetched transparently and successfully
 *     downloaded chunks stay in the cache.
 *   • All caches from older versions are purged on activate.
 */
const VERSION = 'sposremover-v1.5.1';

const SHELL = [
  './',
  './index.html',
  './privacy.html',
  './404.html',
  './manifest.webmanifest',
  './assets/fonts/cairo-arabic-400.woff2',
  './assets/fonts/cairo-latin-400.woff2',
  './assets/fonts/cairo-arabic-600.woff2',
  './assets/fonts/cairo-latin-600.woff2',
  './assets/fonts/cairo-arabic-700.woff2',
  './assets/fonts/cairo-latin-700.woff2',
  './assets/fonts/cairo-arabic-800.woff2',
  './assets/fonts/cairo-latin-800.woff2',
  './assets/css/fonts.css',
  './assets/css/style.css',
  './assets/js/i18n.js',
  './assets/js/exif.js',
  './assets/js/ai.js',
  './assets/js/app.js',
  './assets/vendor/background-removal.mjs',
  './assets/vendor/ort.mjs',
  './assets/vendor/ort-webgpu.mjs',
  './assets/img/company-logo.png',
  './assets/img/favicon.svg',
  './assets/img/favicon-32.png',
  './assets/img/icon-180.png',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/icon-512-maskable.png',
  './assets/img/og.png',
  './favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resilient fetch for AI engine/model files: retries transient failures
 *  so one dropped chunk on a weak mobile network doesn't abort a model download. */
async function fetchWithRetry(req, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(req);
      if (res.ok) return res;
      // 4xx won't fix itself — retry only server/network grades
      if (res.status < 500 && res.status !== 429) return res;
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) {
      lastErr = e; // network-layer failure (dropped connection, timeout)
    }
    if (i < attempts - 1) await sleep(500 * (i + 1) * (i + 1)); // 0.5s, 2s
  }
  throw lastErr || new Error('FETCH_FAILED');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // imgly data CDN (hd model): cache-first for readable CORS responses.
  // Opaque responses (no-cors) can't go into Cache Storage — pass through.
  if (url.origin === 'https://staticimgly.com') {
    if (req.mode === 'no-cors') return;
    event.respondWith(
      caches.match(req).then((hit) => hit || fetchWithRetry(req).then((res) => {
        if (res.ok && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch((err) =>
        caches.match(req).then((r) => r || Promise.reject(err)))),
    );
    return;
  }

  if (url.origin !== location.origin) return; // never touch other CDNs

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  const isModel = url.pathname.startsWith('/assets/models/') || url.pathname.startsWith('/assets/vendor/');
  const isCode = /\.(?:css|js)(?:\?|$)/i.test(url.pathname);
  const isAsset = /\.(?:woff2|png|svg|ico|webmanifest|jpg|jpeg|webp)(?:\?|$)/i.test(url.pathname);

  if (isModel || isAsset) {
    // content-hashed / immutable: cache-first (models offline-forever)
    event.respondWith(
      caches.match(req).then((hit) => hit || fetchWithRetry(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch((err) => {
        // last resort: serve stale copy if one exists (offline after purge)
        return caches.match(req).then((r) => r || Promise.reject(err));
      })),
    );
  } else if (isCode) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
  }
});
