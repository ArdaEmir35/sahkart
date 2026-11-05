// Online bağlantı: PeerJS (WebRTC) ile iki tarayıcı arasında doğrudan bağlantı.
// Oda kodu, PeerJS'in ücretsiz genel sunucusunda eşleşme için kullanılır.
const Net = (() => {
  const PREFIX = 'sahkart-v1-';
  const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';
  let peer = null, conn = null;

  const available = () => typeof Peer !== 'undefined';
  const randomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

  function wire(k, cb) {
    k.on('open', () => cb.onConnect());
    k.on('data', d => cb.onMessage(d));
    k.on('close', () => cb.onClose());
    k.on('error', e => cb.onError(e));
  }

  // Oda aç: cb = { onCode, onConnect, onMessage, onClose, onError }
  function host(cb) {
    const code = randomCode();
    peer = new Peer(PREFIX + code);
    peer.on('open', () => cb.onCode(code));
    peer.on('connection', k => {
      if (conn && conn.open) { k.on('open', () => { k.send({ a: 'full' }); setTimeout(() => k.close(), 300); }); return; }
      conn = k;
      wire(k, cb);
    });
    peer.on('error', e => {
      if (e.type === 'unavailable-id') { peer.destroy(); host(cb); } // kod çakıştı, yenisini dene
      else cb.onError(e);
    });
  }

  function join(code, cb) {
    peer = new Peer();
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, { reliable: true });
      wire(conn, cb);
    });
    peer.on('error', e => cb.onError(e));
  }

  function send(msg) {
    if (conn && conn.open) conn.send(msg);
  }

  function close() {
    try { if (peer) peer.destroy(); } catch (e) { /* yoksay */ }
    peer = conn = null;
  }

  return { available, host, join, send, close };
})();
