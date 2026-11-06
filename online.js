// Online mod: Şahkart sunucusuyla (Supabase) konuşur.
// Hamleler sunucuya gönderilir; güncel durum her oyuncunun gizli realtime kanalından gelir.
// Realtime kopsa bile düzenli yoklama (polling) ile oyun devam eder.
const Online = (() => {
  const URL = 'https://lbfgttaeuqpvtebqrirh.supabase.co';
  const KEY = 'sb_publishable_heiyWFAyDadOL7tBupldVQ_N9VXNJxK'; // herkese açık anahtar (gizli değil)
  const STORE = 'sahkart-session';

  let sb = null, chan = null, pres = null, pollTimer = null, live = false;
  let session = null, handlers = {}, active = false;

  const available = () => typeof supabase !== 'undefined' && !!supabase.createClient;

  function client() {
    if (!sb) sb = supabase.createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return sb;
  }

  // Sunucuya istek: { action, ... } -> yanıt (hata varsa { error })
  async function call(body) {
    try {
      const res = await fetch(URL + '/functions/v1/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY },
        body: JSON.stringify(session ? { id: session.id, token: session.token, ...body } : body),
      });
      return await res.json();
    } catch (e) {
      return { error: 'network' };
    }
  }

  // Oturum hem sekmeye (sessionStorage) hem cihaza (localStorage) kaydedilir:
  // sekme yenilenince sekmedeki, uygulama kapanıp açılınca cihazdaki kullanılır.
  function saveSession(s) {
    session = s;
    for (const st of [sessionStorage, localStorage]) {
      if (s) st.setItem(STORE, JSON.stringify(s)); else st.removeItem(STORE);
    }
  }
  function storedSession(tabOnly = false) {
    const read = st => { try { return JSON.parse(st.getItem(STORE)); } catch (_) { return null; } };
    return read(sessionStorage) || (tabOnly ? null : read(localStorage));
  }

  // Kendi kanalını ve ortak "kim çevrimiçi" kanalını dinle
  // h = { onState(payload), onPresence(opponentOnline), onLive(bool) }
  function listen(s, h) {
    stop();
    saveSession(s);
    handlers = h;
    active = true;
    if (available()) {
      const c = client().channel(s.chan);
      chan = c;
      c.on('broadcast', { event: 'state' }, m => chan === c && handlers.onState && handlers.onState(m.payload))
        .on('broadcast', { event: 'chat' }, m => chan === c && handlers.onChat && handlers.onChat(m.payload))
        .subscribe(status => {
          if (chan !== c) return; // eski kanaldan gelen kapanma bildirimi
          live = status === 'SUBSCRIBED';
          handlers.onLive && handlers.onLive(live);
          if (live) poll(); // abone olurken kaçan güncelleme olmasın
        });
      pres = client().channel('sk-pres-' + s.id, { config: { presence: { key: 'p' + s.side } } });
      pres.on('presence', { event: 'sync' }, () => {
        const st = pres.presenceState();
        handlers.onPresence && handlers.onPresence(!!st['p' + (1 - s.side)]);
      }).subscribe(status => { if (status === 'SUBSCRIBED') pres.track({ side: s.side }); });
    }
    schedulePoll();
  }

  // Yedek yoklama: realtime çalışıyorsa seyrek, çalışmıyorsa sık
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { await poll(); if (session && active) schedulePoll(); }, live ? 12000 : 2500);
  }
  async function poll() {
    if (!session || !active) return;
    const res = await call({ action: handlers.waiting && handlers.waiting() ? 'wait' : 'state' });
    if (session && active && !res.error) handlers.onState && handlers.onState(res);
  }

  function stop() {
    clearTimeout(pollTimer);
    active = false;
    if (sb) {
      if (chan) sb.removeChannel(chan);
      if (pres) sb.removeChannel(pres);
    }
    chan = pres = null;
    live = false;
  }

  function leave() {
    stop();
    saveSession(null);
    handlers = {};
  }

  return {
    available, call, listen, stop, leave, poll, storedSession,
    get session() { return session; },
    get live() { return live; },
    get active() { return active; },
  };
})();
