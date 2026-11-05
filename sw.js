// Şahkart servis çalışanı: oyun dosyalarını önbellekte tutar, internet yokken de bota karşı oynanır.
// Dosyalar güncellenince VERSION değerini artır.
const VERSION = 'sahkart-v3';
const SHELL = [
  './', 'index.html', 'style.css', 'rules.js', 'net.js', 'sound.js', 'tutorial.js', 'game.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon.svg',
];
const PEERJS = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL).then(() => c.add(PEERJS).catch(() => {}))) // online kütüphanesi: alınamazsa sorun değil
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Önce önbellekten hızlıca ver, arkada ağdan tazele (stale-while-revalidate)
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin || url.href.startsWith('https://unpkg.com/peerjs');
  if (!ours) return;
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const key = req.mode === 'navigate' ? './' : req; // ?oda=KOD linkleri de ana sayfayı açar
      const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const fresh = fetch(req)
        .then(res => { if (res.ok) cache.put(key, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
