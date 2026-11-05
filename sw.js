// Şahkart servis çalışanı: oyun dosyalarını önbellekte tutar, internet yokken de bota karşı oynanır.
// İnternet varken her zaman sunucudaki güncel dosyalar kullanılır.
const VERSION = 'sahkart-v5';
const SHELL = [
  './', 'index.html', 'style.css', 'rules.js', 'online.js', 'sound.js', 'tutorial.js', 'game.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon.svg',
];
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL).then(() => c.add(SUPABASE_JS).catch(() => {}))) // online kütüphanesi: alınamazsa sorun değil
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

// Önce ağdan al (her zaman güncel sürüm), internet yoksa önbellekten ver
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin || url.href === SUPABASE_JS;
  if (!ours) return;
  const key = req.mode === 'navigate' ? './' : req; // ?oda=KOD linkleri de ana sayfayı açar
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.open(VERSION).then(c => c.match(key, { ignoreSearch: req.mode === 'navigate' }))),
  );
});
