// Anonim kullanım istatistikleri ve geri bildirim.
// - Sadece oyuncu izin verirse olay gönderilir (GDPR/KVKK). İzin her an geri alınabilir.
// - Kimlik: cihazda rastgele üretilen bir kod. İsim, e-posta, konum vb. toplanmaz.
// - Veriler kendi Supabase veritabanımıza gider; üçüncü taraf takipçi yok.
const Analytics = (() => {
  const API = 'https://lbfgttaeuqpvtebqrirh.supabase.co/rest/v1/';
  const KEY = 'sb_publishable_heiyWFAyDadOL7tBupldVQ_N9VXNJxK'; // herkese açık anahtar (sadece ekleme yetkisi)
  const APP_VER = '2026.11.06';
  const K_CONSENT = 'sahkart-consent', K_ANON = 'sahkart-anon', K_FIRST = 'sahkart-first';

  const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  let anon = localStorage.getItem(K_ANON);
  if (!anon) { anon = rand(12); localStorage.setItem(K_ANON, anon); }
  const session = rand(8);
  let queue = [], timer = null;

  const consent = () => localStorage.getItem(K_CONSENT); // 'yes' | 'no' | null
  const platform = () => {
    if (window.Capacitor && Capacitor.getPlatform) return Capacitor.getPlatform();
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'pwa' : 'web';
  };

  function post(table, rows, keepalive = false) {
    return fetch(API + table, {
      method: 'POST', keepalive,
      headers: { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    }).catch(() => {});
  }

  function flush(keepalive = false) {
    clearTimeout(timer); timer = null;
    if (!queue.length) return;
    const rows = queue; queue = [];
    post('events', rows, keepalive);
  }

  function track(event, props = {}) {
    if (consent() !== 'yes') return;
    queue.push({
      anon_id: anon, session_id: session, event, props,
      lang: typeof I18N !== 'undefined' ? I18N.lang : null, platform: platform(), app_ver: APP_VER,
    });
    if (queue.length >= 20) flush(); else if (!timer) timer = setTimeout(flush, 4000);
  }
  // Sayfa kapanırken kalanları gönder
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });

  // Dışarıdan gelindiyse hangi siteden (sadece alan adı); kendi sitemizden gelişler boş
  function refHost() {
    try { const h = new URL(document.referrer).hostname; return h === location.hostname ? '' : h; } catch (_) { return ''; }
  }

  function appOpen() {
    let first = localStorage.getItem(K_FIRST);
    const returning = !!first;
    if (!first) { first = new Date().toISOString().slice(0, 10); localStorage.setItem(K_FIRST, first); }
    const days = Math.floor((Date.now() - new Date(first + 'T00:00:00').getTime()) / 864e5);
    track('app_open', { returning, days_since_first: days, w: innerWidth, ref: refHost() });
  }

  function setConsent(yes) {
    const before = consent();
    localStorage.setItem(K_CONSENT, yes ? 'yes' : 'no');
    if (yes && before !== 'yes') appOpen();
    if (!yes) queue = [];
  }

  // Geri bildirim izinden bağımsızdır: oyuncu kendisi yazıp gönderir
  function feedback(message, contact, context = {}) {
    return fetch(API + 'feedback', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        anon_id: consent() === 'yes' ? anon : null, message: message.slice(0, 2000),
        contact: contact ? contact.slice(0, 200) : null, lang: typeof I18N !== 'undefined' ? I18N.lang : null,
        context: { ...context, app_ver: APP_VER, platform: platform(), w: innerWidth },
      }),
    }).then(r => r.ok).catch(() => false);
  }

  if (consent() === 'yes') appOpen();

  return { track, flush, setConsent, consent, feedback, appOpen };
})();
