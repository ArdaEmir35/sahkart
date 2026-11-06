// Şahkart / Chromate: arayüz, bot, eğitim ve online mod. Oyun kuralları core.js'te.
const R = Rules;

// mode: 'bot' (bota karşı), 'tutorial' (eğitim), 'online' (sunucu üzerinden arkadaşla / hızlı eşleşme)
let mode = 'bot';
let ME = 0;            // bu tarayıcıdaki oyuncu: 0 = beyaz, 1 = siyah
let S = null;          // oyun durumu (online'da sunucudan gelen kopya)
let ui = { card: null, from: null };
let botDelay = 800, botBusy = false, modalOpen = false, pending = false, rematchAsked = false;
let lastV = -1, oppOnline = true, claimAt = 0, presenceTimer = null;
let serverMeta = { status: '', rematch: [false, false] };
let recvAt = 0;        // online: son durumun geldiği an (saat hesabı için)

// Süre ayarı: "saniye+artış" (ör. "300+3"), "0" = süresiz
let timeControl = localStorage.getItem('sahkart-tc') || '300+3';

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isWhite = side => side === 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const topCard = () => Core.topCard(S);
const optionsFor = side => Core.optionsFor(S, side);

function nameOf(side) {
  if (side === ME) return t('name.you');
  if (mode === 'bot') return t('name.bot', { level: t('level.' + botLevel) });
  if (mode === 'tutorial') return t('name.botPlain');
  return t('name.opp');
}

function cardLabel(card) {
  if (card.kind === 'wild') return t('card.wild');
  const color = t('color.' + card.color);
  if (card.kind === 'skip') return t('label.skip', { color });
  if (card.kind === 'draw2') return t('label.draw2', { color });
  return t('label.piece', { color, piece: t('piece.' + card.piece) });
}

// ---------- yerel oyun (bot ve eğitim) ----------
function newGame() {
  S = Core.newGame(timeControl);
  rematchAsked = false;
  botBusy = false;
  afterChange();
}

// Durum değişti: çiz, sıra bottaysa onu oynat
function afterChange() {
  ui = { card: null, from: null };
  render();
  if (mode === 'bot' && !S.over && S.turn === 1 && !botBusy) {
    if (S.drawn) botAfterDraw(); else botTurn();
  }
}

// Yerel eylemi çekirdekte uygula; hata varsa uyar
function localAct(side, a) {
  const err = Core.act(S, side, a);
  if (err) { flash(t('err.' + err)); return err; }
  afterChange();
  return null;
}

function clockLeft(i) {
  const k = S.clock;
  let ms = k.left[i];
  if (k.since != null && i === k.running && !S.over)
    ms -= mode === 'online' ? k.el + (Date.now() - recvAt) : Date.now() - k.since;
  return Math.max(0, ms);
}

// ---------- oyuncu eylemleri (guest'te host'a gönderilir) ----------
function canAct() {
  return S && !S.over && S.turn === ME && !botBusy && !modalOpen && !pending;
}

function doPlay(opt, color) {
  if (mode === 'tutorial') {
    const err = Tutorial.check({ type: 'play', opt, color });
    ui = { card: null, from: null };
    if (err) { render(); return flash(err); }
    localAct(ME, { action: 'play', cardId: opt.card.id, move: opt.move, color });
    return Tutorial.advance();
  }
  if (mode === 'online') {
    const m = opt.move;
    return sendAction({ action: 'play', cardId: opt.card.id, move: m && { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc }, color });
  }
  localAct(ME, { action: 'play', cardId: opt.card.id, move: opt.move, color });
}

function doDrawOrPass() {
  if (!canAct()) return;
  if (mode === 'tutorial') {
    const type = S.drawn ? 'pass' : 'draw';
    const err = Tutorial.check({ type });
    if (err) return flash(err);
    localAct(ME, { action: type });
    return Tutorial.advance();
  }
  if (mode === 'online') return sendAction({ action: S.drawn ? 'pass' : 'draw' });
  localAct(ME, { action: S.drawn ? 'pass' : 'draw' });
}

function doRematch() {
  Analytics.track('rematch', { mode: gameKind() });
  if (mode === 'online') return sendAction({ action: 'rematch' });
  newGame();
}

// ---------- online: sunucu hakem, biz sadece gösteriyoruz ----------
async function sendAction(body) {
  pending = true;
  ui = { card: null, from: null };
  render();
  const res = await Online.call(body);
  pending = false;
  if (res.error) { render(); flash(errText(res.error)); Online.poll(); return; }
  onServer(res);
}

// Sunucudan gelen durum (istek yanıtı, realtime ya da yoklama)
function onServer(p) {
  if (!p || p.error || !Online.active || !Online.session || p.id !== Online.session.id) return;
  if (typeof p.v === 'number') { if (p.v < lastV) return; lastV = p.v; }
  serverMeta = { status: p.status, rematch: p.rematch || [false, false] };
  if (p.status === 'cancelled') { Online.leave(); return lobbyError(t('err.cancelled')); }
  if (!p.view) return; // rakip bekleniyor
  if (mode !== 'online') {
    mode = 'online'; ME = Online.session.side; S = null; hideLobby();
    if (waitStartAt) Analytics.track('matched', { mode: gameKind(), wait_s: Math.round((Date.now() - waitStartAt) / 1000) });
    waitStartAt = 0;
  }
  const v = p.view;
  const turnChanged = !S || S.gameId !== v.gameId || S.turn !== v.turn || S.over !== v.over;
  S = v;
  S.deck = new Array(v.deck);
  recvAt = Date.now();
  pending = false;
  rematchAsked = !!(S.over && serverMeta.rematch[ME]);
  if (turnChanged || S.drawn) ui = { card: null, from: null };
  updateNetStatus();
  render();
}

// Sunucu hata kodunu okunur metne çevir
const errText = code => (I18N.has('err.' + code) ? t('err.' + code) : t('err.generic'));

function updateNetStatus() {
  if (mode !== 'online' || !Online.session) return setNetStatus('');
  const id = Online.session.id;
  const label = id.length === 4 ? t('net.room', { code: id }) : t('net.quick');
  if (!oppOnline && S && !S.over) setNetStatus(t('net.oppOffline', { label }), false);
  else setNetStatus(t('net.connected', { label }), true);
}

// ---------- insan arayüzü ----------
function myOptions(card) {
  return R.cardOptions(S.board, isWhite(ME), card, topCard(), S.activeColor);
}

function onCardClick(card) {
  if (!canAct()) return;
  if (S.drawn && card.id !== S.drawn) return flash(t('warn.onlyDrawn'));
  const opts = myOptions(card);
  if (!opts.length) return flash(R.matches(card, topCard(), S.activeColor)
    ? t('warn.noMove')
    : t('warn.noMatch'));
  if (ui.card && ui.card.id === card.id) { ui = { card: null, from: null }; return render(); }
  if (card.kind === 'skip' || card.kind === 'draw2') return doPlay(opts[0]);
  ui = { card, from: null };
  render();
}

function onSquareClick(r, c) {
  if (!canAct() || !ui.card) return;
  const opts = myOptions(ui.card);
  if (ui.from) {
    const opt = opts.find(o => o.move.fr === ui.from[0] && o.move.fc === ui.from[1] && o.move.tr === r && o.move.tc === c);
    if (opt) {
      if (ui.card.kind === 'wild') return askColor(color => doPlay(opt, color));
      return doPlay(opt);
    }
  }
  ui.from = opts.some(o => o.move.fr === r && o.move.fc === c) ? [r, c] : null;
  render();
}

function askColor(cb) {
  modalOpen = true;
  render();
  document.querySelectorAll('#color-pick [data-color]').forEach(btn => {
    btn.onclick = () => { modalOpen = false; cb(+btn.dataset.color); render(); };
  });
}

// ---------- bot (siyah, side 1) ----------
// Seviyeler: rastgelelik, hata payı, tehlike ve şah güvenliği ağırlıkları
const LEVELS = {
  easy:   { noise: 2.2, blunder: 0.45, hang: 0.15, king: 3,  drawBelow: -4,   smart: false },
  normal: { noise: 0.35, blunder: 0, hang: 0.75, king: 25, drawBelow: -1.2, smart: false },
  hard:   { noise: 0.05, blunder: 0, hang: 0.95, king: 32, drawBelow: -0.8, smart: true },
};
let botLevel = LEVELS[localStorage.getItem('sahkart-level')] ? localStorage.getItem('sahkart-level') : 'normal';

async function botTurn() {
  const game = S;
  botBusy = true;
  render();
  await sleep(botDelay);
  if (S !== game) return; // bu arada yeni oyun başladı
  botBusy = false;
  if (S.over || mode !== 'bot') return;
  const best = pickBest(optionsFor(1), 1, LEVELS[botLevel]);
  if (!best) return localAct(1, { action: 'draw' });
  playBot(best, 1, LEVELS[botLevel]);
}

async function botAfterDraw() {
  const game = S;
  botBusy = true;
  render();
  await sleep(botDelay * 0.6);
  if (S !== game) return;
  botBusy = false;
  if (S.over || mode !== 'bot') return;
  const card = S.hands[1].find(c => c.id === S.drawn);
  const best = card && pickBest(Core.cardOptions(S, 1, card), 1, LEVELS[botLevel], true);
  if (best) playBot(best, 1, LEVELS[botLevel]); else localAct(1, { action: 'pass' });
}

// En iyi seçeneği seç; hepsi kötüyse (eşik altı) null döner ve bot kart çeker
function pickBest(opts, side, L, afterDraw = false) {
  if (!opts.length) return null;
  const kingCap = opts.find(o => o.move && S.board[o.move.tr][o.move.tc]?.t === 'k');
  if (kingCap) return kingCap; // şahı almayı hiçbir seviye kaçırmaz
  if (L.blunder && Math.random() < L.blunder) return opts[Math.floor(Math.random() * opts.length)];
  let best = null, bestScore = afterDraw && L.smart ? -2 : L.drawBelow;
  for (const o of opts) {
    const s = evaluate(o, side, L);
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return best;
}

function playBot(opt, side, L) {
  const color = opt.card.kind === 'wild' ? bestColorFor(side, opt.card, L) : undefined;
  localAct(side, { action: 'play', cardId: opt.card.id, move: opt.move, color });
}

// Bir seçeneği 'side' tarafı açısından puanlar
function evaluate(opt, side, L) {
  const white = isWhite(side);
  const { card, move } = opt;
  const oppCards = S.hands[1 - side].length;
  const myCards = S.hands[side].length;
  let score = Math.random() * L.noise;
  if (card.kind === 'skip') score += 1.3;
  if (card.kind === 'draw2') score += 1.1;
  if (card.kind === 'wild') score -= L.smart ? 2.5 : 1.5; // jokeri boşa harcama
  if (L.smart) {
    // Rakip bitirmek üzereyse onu kart çekmeye zorla
    if (oppCards <= 2 && (card.kind === 'draw2' || card.kind === 'skip')) score += 3;
    if (oppCards <= 2 && R.zoneBonus(card, move)) score += 1.5;
    if (card.kind === 'wild' && oppCards <= 2) score += 1.5;
    // Elde kalan kartların sonraki turda oynanabilirliği (esneklik)
    const rest = S.hands[side].filter(c => c.id !== card.id);
    const nextColor = card.kind === 'wild' ? bestColorFor(side, card, L) : card.color;
    score += rest.filter(c => R.matches(c, card, nextColor)).length * 0.18;
    if (myCards <= 3) score += 0.4; // bitirmeye yakınken kart harcamak değerli
  }
  if (!move) return score;
  if (R.zoneBonus(card, move)) score += 0.7;

  const b = S.board;
  const piece = b[move.fr][move.fc];
  const cap = b[move.tr][move.tc];
  if (cap && cap.t === 'k') return 10000;
  const V = R.VALUE;

  const before = R.minAttacker(b, move.fr, move.fc, !white);
  const b2 = R.cloneBoard(b);
  R.applyMove(b2, { ...move });
  const moved = b2[move.tr][move.tc];

  if (cap) score += V[cap.t];
  if (moved.t !== piece.t) score += 8; // terfi

  // Taşın gittiği kare tehlikede mi? (rakibin uygun kartı olmayabilir, o yüzden <1)
  const att = R.minAttacker(b2, move.tr, move.tc, !white);
  if (att) {
    const defended = R.minAttacker(b2, move.tr, move.tc, white);
    const pv = Math.min(V[moved.t], 20);
    score -= (defended ? Math.max(0, pv - att) : pv) * L.hang;
  }
  if (before && !att) score += Math.min(V[piece.t], 20) * 0.5; // tehditten kaçış

  // Şah güvenliği: sadece durumdaki değişimi puanla
  const kingNow = R.findKing(b, white);
  const dangerNow = kingNow && R.minAttacker(b, kingNow[0], kingNow[1], !white);
  const myKing = R.findKing(b2, white);
  const dangerAfter = myKing && R.minAttacker(b2, myKing[0], myKing[1], !white);
  if (dangerAfter && !dangerNow) score -= L.king;
  if (dangerNow && !dangerAfter) score += L.king;
  const oppKing = R.findKing(b2, !white);
  if (oppKing && R.minAttacker(b2, oppKing[0], oppKing[1], white)) score += L.smart && !att ? 4 : 2;

  if (L.smart) {
    // Kalan taşlarımızdan biri bu hamleyle korumasız kaldı mı? (en değerli asılı taş)
    let hangingAfter = 0, hangingNow = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p2 = b2[r][c];
        if (p2 && p2.w === white && p2.t !== 'k' && !(r === move.tr && c === move.tc)) {
          if (R.minAttacker(b2, r, c, !white) && !R.minAttacker(b2, r, c, white)) hangingAfter = Math.max(hangingAfter, V[p2.t]);
        }
        const p1 = b[r][c];
        if (p1 && p1.w === white && p1.t !== 'k' && !(r === move.fr && c === move.fc)) {
          if (R.minAttacker(b, r, c, !white) && !R.minAttacker(b, r, c, white)) hangingNow = Math.max(hangingNow, V[p1.t]);
        }
      }
    score -= Math.max(0, hangingAfter - hangingNow) * 0.5;
  }

  const centre = 3.5 - Math.max(Math.abs(move.tr - 3.5), Math.abs(move.tc - 3.5));
  if (piece.t === 'n' || piece.t === 'b') score += centre * 0.08;
  if (piece.t === 'p') score += 0.1;
  if (piece.t === 'k' && !att) score -= 0.3;
  return score;
}

function bestColorFor(side, playedCard, L) {
  const counts = [0, 0, 0, 0];
  S.hands[side].forEach(c => { if (c.id !== playedCard.id && c.color !== null) counts[c.color]++; });
  return counts.indexOf(Math.max(...counts));
}

// ---------- çizim ----------
let flashTimer;
function flash(msg) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.add('warn');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.classList.remove('warn'); render(); }, 1600);
}

function cardSymbol(card) {
  if (card.kind === 'piece') return R.GLYPH[card.piece] + '︎';
  if (card.kind === 'skip') return '⏭︎';
  if (card.kind === 'draw2') return '+2';
  return '★';
}
function cardTag(card) {
  return '<span class="tag ' + (card.kind === 'wild' ? 'wild' : 'c' + card.color) + '">' + cardSymbol(card) + '</span>';
}

const seenCards = new Set(); // sadece yeni görünen kartlar animasyon alsın
function cardEl(card, opts = {}) {
  const d = document.createElement('div');
  const key = (opts.back ? 'b' : opts.pile ? 'p' : 'f') + card.id;
  const isNew = !seenCards.has(key);
  seenCards.add(key);
  if (opts.back) { d.className = 'card back' + (isNew ? ' new' : ''); return d; }
  d.className = 'card ' + (card.kind === 'wild' ? 'wild' : 'c' + card.color);
  if (isNew) d.classList.add('new');
  if (opts.playable) d.classList.add('playable');
  if (opts.dim) d.classList.add('dim');
  if (opts.selected) d.classList.add('selected');
  const label = card.kind === 'piece' ? t('piece.' + card.piece) : t('card.' + card.kind);
  d.innerHTML = '<span class="corner">' + cardSymbol(card) + '</span><span class="sym">' + cardSymbol(card) + '</span><span class="lbl">' + label + '</span>';
  d.title = cardLabel(card);
  return d;
}

// Kayıt satırını (olay kodu) seçili dilde HTML'e çevir
function logHtml(e) {
  const p = e.p || {};
  const me = e.s === ME;
  const name = side => esc(nameOf(side));
  // "sen" için ayrı cümle varsa onu kullan (ör. "Kart çektin")
  const say = (key, side, params = {}) => t(side === ME && I18N.has(key + '.me') ? key + '.me' : key, { name: name(side), ...params });
  switch (e.k) {
    case 'start': return t('log.start', { card: cardTag(p.card) });
    case 'reshuffle': return t('log.reshuffle');
    case 'lesson': return t('log.lesson', { n: p.n, title: t('tut.' + p.n + '.title') });
    case 'play': {
      let h = name(e.s) + ': ' + cardTag(p.card);
      if (p.move) {
        h += ' → ' + R.GLYPH[p.move.piece] + '︎ ' + p.move.from + '–' + p.move.to;
        if (p.move.cap) h += ' <b>(' + t('log.captured', { piece: t('piece.' + p.move.cap) }) + ')</b>';
        if (p.move.promo) h += ' — ' + t('log.promo');
      }
      if (p.color != null) h += ' · ' + t('log.newColor') + ' <span class="dot c' + p.color + '"></span>' + t('color.' + p.color);
      if (p.again) h += ' — ' + t('log.again');
      if (p.draw2 != null) h += ' — ' + say('log.drewN', 1 - e.s, { n: p.draw2 });
      if (p.bonus) h += ' — <i>' + t('log.bonus') + '</i>: ' + say('log.drewN', 1 - e.s, { n: p.bonus });
      return h;
    }
    case 'emptied': case 'noCards': case 'drewPassed': case 'drew': case 'passed': case 'timeout': case 'resign':
      return say('log.' + e.k, e.s);
  }
  return '';
}

let renderedLogLen = 0;
function renderLog() {
  const box = $('#log');
  box.innerHTML = '';
  S.log.forEach(e => {
    const el = document.createElement('div');
    const cls = e.s < 0 ? 'sys' : e.end ? (S.winner === ME ? 'win' : 'lose') : e.s === ME ? 'me' : 'bot';
    el.className = 'log-line ' + cls;
    el.innerHTML = logHtml(e);
    box.appendChild(el);
  });
  if (S.log.length !== renderedLogLen) { box.scrollTop = box.scrollHeight; renderedLogLen = S.log.length; }
}

let lastBoardKey = '';
let tutHint = {};
function drawBoard(boardEl, flip, fromSet, toSet, targetZone) {
  boardEl.innerHTML = '';
  for (let dr = 0; dr < 8; dr++)
    for (let dc = 0; dc < 8; dc++) {
      const r = flip ? 7 - dr : dr, c = flip ? 7 - dc : dc;
      const sq = document.createElement('div');
      sq.className = 'sq z' + R.zone(c) + ((r + c) % 2 ? ' dark' : ' light');
      if (targetZone !== null && R.zone(c) === targetZone) sq.classList.add('target-zone');
      const k = r * 8 + c;
      const lm = S.lastMove;
      if (lm && ((lm.fr === r && lm.fc === c) || (lm.tr === r && lm.tc === c))) sq.classList.add('last', lm.tr === r && lm.tc === c ? 'last-to' : 'last-from');
      if (fromSet.has(k)) sq.classList.add('can-from');
      if (tutHint.squares && tutHint.squares.has(k)) sq.classList.add('hint-sq');
      if (ui.from && ui.from[0] === r && ui.from[1] === c) sq.classList.add('sel');
      if (toSet.has(k)) sq.classList.add(S.board[r][c] ? 'can-cap' : 'can-to');
      const p = S.board[r][c];
      if (p) {
        const pe = document.createElement('span');
        pe.className = 'piece ' + (p.w ? 'white' : 'black');
        pe.textContent = R.GLYPH[p.t] + '︎';
        sq.appendChild(pe);
      }
      sq.onclick = () => onSquareClick(r, c);
      boardEl.appendChild(sq);
    }
}

// Son oynanan taşı eski karesinden yeni karesine kaydır (chess.com tarzı)
let animatedMove = '';
function animateLastMove(boardEl, flip) {
  const key = S.gameId + ':' + S.moveNo;
  if (!S.lastMove || key === animatedMove) return;
  const first = !animatedMove.startsWith(S.gameId + ':'); // bağlanınca eski hamleyi oynatma
  animatedMove = key;
  if (first && S.moveNo > 1) return;
  const lm = S.lastMove;
  const d = (r, c) => (flip ? [7 - r, 7 - c] : [r, c]);
  const [fr, fc] = d(lm.fr, lm.fc), [tr, tc] = d(lm.tr, lm.tc);
  const pe = boardEl.children[tr * 8 + tc]?.querySelector('.piece');
  const size = boardEl.children[0].offsetWidth;
  if (!pe || !pe.animate) return;
  pe.style.zIndex = 5;
  pe.animate(
    [{ transform: `translate(${(fc - tc) * size}px, ${(fr - tr) * size}px)` }, { transform: 'none' }],
    { duration: 200, easing: 'cubic-bezier(.3,.7,.4,1)' },
  ).onfinish = () => (pe.style.zIndex = '');
}

// Durumdaki yeni ses olaylarını çal
let soundGame = '', lastSfx = 0, endSounded = '';
function playNewSounds() {
  if (soundGame !== S.gameId) {
    soundGame = S.gameId;
    lastSfx = S.sfxN; // önceki oyunun / katılmadan önceki sesleri çalma
    Sound.play('start');
  }
  let delay = 0;
  for (const e of S.sfx) {
    if (e.n <= lastSfx) continue;
    Sound.play(e.k, delay);
    delay += e.k === 'move' || e.k === 'capture' ? 0.12 : 0.08;
  }
  lastSfx = S.sfxN;
  if (S.over && endSounded !== S.gameId) {
    endSounded = S.gameId;
    Sound.play(S.winner === ME ? 'win' : 'lose', delay + 0.25);
  }
}

// ---------- saat ----------
function fmtClock(ms) {
  if (ms < 10000) return (Math.floor(ms / 100) / 10).toFixed(1);
  const sec = Math.ceil(ms / 1000);
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

let lastTickSec = -1;
function updateClocks() {
  const show = !!(S && S.clock);
  $('#clock-me').classList.toggle('hidden', !show);
  $('#clock-opp').classList.toggle('hidden', !show);
  if (!show) return;
  const k = S.clock;
  [[ME, '#clock-me'], [1 - ME, '#clock-opp']].forEach(([side, sel]) => {
    const ms = clockLeft(side);
    const el = $(sel);
    el.textContent = fmtClock(ms);
    const running = !S.over && k.since != null && k.running === side;
    el.classList.toggle('on', running);
    el.classList.toggle('low', ms < 20000);
    if (side === ME && running && ms < 10000) {
      const sec = Math.ceil(ms / 1000);
      if (sec !== lastTickSec) { lastTickSec = sec; Sound.play('tick'); }
    }
  });
  // Süre bitti mi? Online'da sunucu karar verir, biz sadece haber veririz
  if (mode === 'online') {
    if (!S.over && k.since != null && clockLeft(k.running) <= 0 && Date.now() - claimAt > 1500) {
      claimAt = Date.now();
      Online.call({ action: 'state' }).then(onServer);
    }
  } else if (!S.over && Core.checkTimeout(S)) {
    render();
  }
}
setInterval(updateClocks, 100);

function render() {
  if (!S) return;
  const OPP = 1 - ME;
  const active = canAct();
  const selOpts = ui.card ? myOptions(ui.card) : [];
  const fromSet = new Set(selOpts.map(o => o.move && o.move.fr * 8 + o.move.fc));
  const toSet = new Set(ui.from ? selOpts.filter(o => o.move.fr === ui.from[0] && o.move.fc === ui.from[1]).map(o => o.move.tr * 8 + o.move.tc) : []);
  const targetZone = ui.card && ui.card.kind === 'piece' ? ui.card.color : null;
  const flip = ME === 1; // siyah oynayan kendi taşlarını altta görür
  tutHint = mode === 'tutorial' ? Tutorial.hint() : {};

  // Tahta (değişmediyse yeniden çizme, yoksa taş animasyonu yarıda kesilir)
  const boardEl = $('#board');
  const boardKey = JSON.stringify([S.board, S.lastMove, ui.card && ui.card.id, ui.from, flip, topCard().id, S.activeColor, [...(tutHint.squares || [])]]);
  if (boardKey !== lastBoardKey) { lastBoardKey = boardKey; drawBoard(boardEl, flip, fromSet, toSet, targetZone); }
  animateLastMove(boardEl, flip);
  playNewSounds();
  $('#files').innerHTML = Array.from({ length: 8 }, (_, i) => {
    const c = flip ? 7 - i : i;
    return '<span class="z' + R.zone(c) + '">' + 'abcdefgh'[c] + '</span>';
  }).join('');

  // Eller
  const oppHand = $('#opp-hand');
  oppHand.innerHTML = '';
  S.hands[OPP].forEach(c => oppHand.appendChild(cardEl(c, { back: true })));
  $('#opp-label').textContent = t('cards.count', { name: nameOf(OPP), n: S.hands[OPP].length });
  $('#turn-me').textContent = t('name.you');

  const myHand = $('#my-hand');
  myHand.innerHTML = '';
  const sorted = [...S.hands[ME]].sort((a, b) => (a.color ?? 9) - (b.color ?? 9) || R.sym(a).localeCompare(R.sym(b)));
  sorted.forEach(card => {
    const playable = active && (!S.drawn || card.id === S.drawn) && myOptions(card).length > 0;
    const el = cardEl(card, { playable, dim: active && !playable, selected: ui.card && ui.card.id === card.id });
    if (tutHint.card === card.id && !(ui.card && ui.card.id === card.id)) el.classList.add('hint');
    el.onclick = () => onCardClick(card);
    myHand.appendChild(el);
  });

  // Orta alan
  const pile = $('#pile');
  pile.innerHTML = '';
  pile.appendChild(cardEl(topCard(), { pile: true }));
  $('#deck-cap').textContent = t('pile.deck', { n: S.deck.length });
  const ac = $('#active-color');
  ac.className = 'active-color c' + S.activeColor;
  ac.textContent = t('color.' + S.activeColor);
  $('#draw-btn').disabled = !active;
  $('#draw-btn').classList.toggle('hint', !!tutHint.deck);
  $('#coach').classList.toggle('hidden', mode !== 'tutorial');
  document.body.classList.toggle('tutorial', mode === 'tutorial');
  if (mode === 'tutorial') Tutorial.renderCoach();
  $('#draw-label').textContent = S.turn === ME && S.drawn ? t('pile.pass') : t('pile.draw');

  // Durum
  const st = $('#status');
  if (!st.classList.contains('warn')) {
    if (mode === 'tutorial') st.textContent = '';
    else if (S.over) st.textContent = S.winner === ME ? t('st.win') : t('st.won', { name: nameOf(S.winner) });
    else if (S.turn !== ME) st.textContent = mode === 'bot' ? t('st.botThinking') : t('st.oppTurn');
    else if (pending) st.textContent = t('st.sending');
    else if (!ui.card && S.drawn) st.textContent = t('st.drawn');
    else if (!ui.card) st.textContent = optionsFor(ME).length ? t('st.pick') : t('st.mustDraw');
    else if (!ui.from) st.textContent = ui.card.kind === 'wild' ? t('st.wild')
      : t('st.piece', { piece: t('piece.' + ui.card.piece), color: t('color.' + ui.card.color) });
    else st.textContent = t('st.target');
  }
  $('#turn-me').classList.toggle('on', S.turn === ME && !S.over);
  $('#turn-opp').classList.toggle('on', S.turn === OPP && !S.over);

  // Pencereler: renk seçimi / oyun sonu
  $('#overlay').classList.toggle('hidden', !modalOpen && (!S.over || mode === 'tutorial'));
  $('#color-pick').classList.toggle('hidden', !modalOpen);
  $('#result').classList.toggle('hidden', !S.over || modalOpen || mode === 'tutorial');
  if (S.over) {
    $('#overlay-title').textContent = S.winner === ME ? t('end.win') : t('end.lose');
    const oppWants = mode === 'online' && serverMeta.rematch[1 - ME] && !rematchAsked;
    const reason = S.reason === 'resign' && S.winner !== ME ? t('reason.resign.me') : t('reason.' + S.reason);
    $('#overlay-text').textContent = reason + '.' + (oppWants ? t('end.oppWants') : '');
    $('#again').textContent = rematchAsked ? t('again.wait') : t('again');
    $('#again').disabled = rematchAsked;
  }
  $('#resign-btn').classList.toggle('hidden', mode !== 'online' || S.over);
  trackLifecycle();
  renderLog();
  updateClocks();
}

// ---------- istatistik: oyun başı / sonu ----------
let trackedStart = '', trackedEnd = '', gameStartAt = 0, waitStartAt = 0;
const gameKind = () => (mode === 'bot' ? 'bot' : Online.session && Online.session.id.length === 4 ? 'room' : 'quick');
const gameTC = () => (S.clock ? S.clock.base / 1000 + '+' + S.clock.inc / 1000 : '0');
function trackLifecycle() {
  if (!S || (mode !== 'bot' && mode !== 'online')) return;
  const props = { mode: gameKind(), level: mode === 'bot' ? botLevel : undefined, tc: gameTC() };
  if (trackedStart !== S.gameId) {
    trackedStart = S.gameId;
    gameStartAt = Date.now();
    if (!S.over) Analytics.track('game_start', { ...props, resumed: S.moveNo > 0 });
  }
  if (S.over && trackedEnd !== S.gameId) {
    trackedEnd = S.gameId;
    Analytics.track('game_end', { ...props, result: S.winner === ME ? 'win' : 'lose', reason: S.reason, moves: S.moveNo, secs: Math.round((Date.now() - gameStartAt) / 1000) });
  }
}

// ---------- lobi ----------
function lobbyView(v) {
  $('#lobby').classList.remove('hidden');
  ['menu', 'hosting', 'joining', 'searching'].forEach(x => $('#lobby-' + x).classList.toggle('hidden', x !== v));
}
function hideLobby() { $('#lobby').classList.add('hidden'); }
function lobbyError(msg) {
  mode = 'bot'; ME = 0; S = null;
  setNetStatus('');
  lobbyView('menu');
  $('#lobby-error').textContent = msg;
}
function setNetStatus(text, ok) {
  const el = $('#net-status');
  el.textContent = text;
  el.className = 'net-status ' + (ok ? 'ok' : 'bad');
  el.classList.toggle('hidden', !text);
  $('#speed-wrap').classList.toggle('hidden', mode !== 'bot');
}

function startTutorial() {
  Analytics.track('tutorial_start', { done_before: Tutorial.isDone() });
  mode = 'tutorial'; ME = 0;
  hideLobby();
  setNetStatus('');
  Tutorial.start();
}

function startBotGame() {
  mode = 'bot'; ME = 0;
  hideLobby();
  setNetStatus('');
  newGame();
}

function noOnline() {
  if (Online.available()) return false;
  lobbyError(t('err.noOnline'));
  return true;
}

// Sunucudan oyun kimliği alındı: kanalları dinlemeye başla
function startSession(res) {
  lastV = -1;
  oppOnline = true;
  serverMeta = { status: res.status, rematch: res.rematch || [false, false] };
  Online.listen({ id: res.id, token: res.token, chan: res.chan, side: res.side }, {
    onState: onServer,
    onPresence: on => {
      // Kısa kopmaları (sayfa yükleniyor, ağ değişiyor) uyarı olarak gösterme
      clearTimeout(presenceTimer);
      if (on) { oppOnline = true; return updateNetStatus(); }
      presenceTimer = setTimeout(() => { oppOnline = false; updateNetStatus(); }, 4000);
    },
    onLive: () => updateNetStatus(),
    waiting: () => serverMeta.status === 'waiting',
  });
  onServer(res);
}

function showHosting(code) {
  lobbyView('hosting');
  $('#room-code').textContent = code || '····';
  $('#room-link').value = code ? location.origin + location.pathname + '?oda=' + code : '';
}

async function hostRoom() {
  if (noOnline()) return;
  Online.leave();
  showHosting('');
  const res = await Online.call({ action: 'create', tc: timeControl });
  if (res.error) return lobbyError(errText(res.error));
  Analytics.track('room_create', { tc: timeControl });
  waitStartAt = Date.now();
  showHosting(res.id);
  startSession(res);
}

async function joinRoom(code) {
  code = (code || '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) return lobbyError(t('err.code'));
  if (noOnline()) return;
  const saved = Online.storedSession(true);
  if (saved && saved.id === code) return resumeSession(saved); // bu sekme zaten bu odadaydı
  Online.leave();
  lobbyView('joining');
  $('#joining-msg').innerHTML = t('lobby.joining', { code });
  const res = await Online.call({ action: 'join', code });
  Analytics.track(res.error ? 'room_join_fail' : 'room_join', res.error ? { err: res.error } : {});
  if (res.error) return lobbyError(errText(res.error));
  startSession(res);
}

async function quickMatch() {
  if (noOnline()) return;
  Online.leave();
  lobbyView('searching');
  $('#search-tc').textContent = tcSel.options[tcSel.selectedIndex].text;
  waitStartAt = Date.now();
  Analytics.track('quick_search', { tc: timeControl });
  const res = await Online.call({ action: 'quick', tc: timeControl });
  if (res.error) return lobbyError(errText(res.error));
  startSession(res);
}

async function cancelWaiting() {
  if (Online.session) Analytics.track(Online.session.id.length === 4 ? 'room_cancel' : 'quick_cancel', { wait_s: Math.round((Date.now() - waitStartAt) / 1000) });
  if (Online.session) Online.call({ action: 'cancel' });
  Online.leave();
  lobbyError('');
}

// Yarım kalan online oyuna geri dön (sayfa yenilendi, telefon kilitlendi vb.)
async function resumeSession(saved) {
  if (noOnline()) return;
  lobbyView('joining');
  $('#joining-msg').textContent = t('lobby.resuming');
  startSession({ ...saved, status: 'waiting' });
  const res = await Online.call({ action: 'state' });
  if (res.error || res.status === 'cancelled' || res.status === 'over') {
    Online.leave();
    return res.status === 'over' ? showMenu() : lobbyError(res.error === 'network' ? t('err.network') : res.error ? t('err.gone') : '');
  }
  if (res.status === 'waiting') {
    serverMeta.status = 'waiting';
    return saved.id.length === 4 ? showHosting(saved.id) : lobbyView('searching');
  }
  onServer(res);
}

function leaveOnline() {
  if (S && S.over) Online.leave(); else Online.stop(); // bitmemiş oyuna sonra dönülebilir
  showMenu();
}

// ---------- olaylar ----------
$('#draw-btn').onclick = doDrawOrPass;
$('#again').onclick = doRematch;
$('#new-game').onclick = () => {
  if (mode === 'tutorial') return showMenu();
  if (mode === 'bot') return S && !S.over && S.log.length > 2 && !confirm(t('confirm.newGame')) ? null : showMenu();
  if (S && S.over) return leaveOnline();
  if (confirm(t('confirm.leave'))) leaveOnline();
};
$('#speed').onchange = e => (botDelay = +e.target.value);
function showLevel() {
  document.querySelectorAll('#level [data-level]').forEach(b => {
    b.classList.toggle('on', b.dataset.level === botLevel);
    b.setAttribute('aria-checked', b.dataset.level === botLevel);
  });
}
document.querySelectorAll('#level [data-level]').forEach(b => {
  b.onclick = () => { botLevel = b.dataset.level; localStorage.setItem('sahkart-level', botLevel); showLevel(); };
});
showLevel();
// Süre seçeneklerinin etiketleri (dile göre)
function tcLabel(v) {
  const [base, inc] = v.split('+').map(Number);
  if (!base) return t('tc.none');
  return inc ? t('tc.minInc', { m: base / 60, s: inc }) : t('tc.min', { m: base / 60 });
}
function labelTimeControls() {
  document.querySelectorAll('#time-ctrl option').forEach(o => (o.textContent = tcLabel(o.value)));
}

// Dil seçimi: üst çubukta ve menüde
function applyLanguage() {
  I18N.apply();
  labelTimeControls();
  showSound();
  ['#lang-sel', '#lang-sel-lobby'].forEach(sel => ($(sel).value = I18N.lang));
  if (mode === 'online') updateNetStatus();
  lastBoardKey = '';
  render();
}
['#lang-sel', '#lang-sel-lobby'].forEach(sel => ($(sel).onchange = e => { I18N.set(e.target.value); Analytics.track('lang_change', { lang: e.target.value }); }));
I18N.onChange(applyLanguage);

const tcSel = $('#time-ctrl');
tcSel.value = timeControl;
if (tcSel.value !== timeControl) tcSel.value = timeControl = '300+3';
tcSel.onchange = () => { timeControl = tcSel.value; localStorage.setItem('sahkart-tc', timeControl); };
const soundBtn = $('#sound-btn');
const showSound = () => { soundBtn.textContent = Sound.isMuted() ? '🔇' : '🔊'; soundBtn.title = Sound.isMuted() ? t('sound.on') : t('sound.off'); };
soundBtn.onclick = () => { Sound.setMuted(!Sound.isMuted()); showSound(); if (!Sound.isMuted()) Sound.play('move'); };
applyLanguage();
$('#rules-btn').onclick = () => $('#rules').classList.toggle('hidden');
$('#btn-bot').onclick = startBotGame;
$('#btn-tutorial').onclick = startTutorial;
$('#coach-next').onclick = () => Tutorial.next();
$('#coach-exit').onclick = showMenu;
$('#btn-host').onclick = hostRoom;
$('#btn-join').onclick = () => joinRoom($('#join-code').value);
$('#join-code').onkeydown = e => { if (e.key === 'Enter') joinRoom(e.target.value); };
$('#cancel-host').onclick = $('#cancel-search').onclick = cancelWaiting;
$('#cancel-join').onclick = () => { Online.leave(); lobbyError(''); };
$('#btn-quick').onclick = quickMatch;
$('#btn-resume').onclick = () => { const s = Online.storedSession(); if (s) resumeSession(s); };
$('#resign-btn').onclick = () => {
  if (mode === 'online' && S && !S.over && confirm(t('confirm.resign'))) sendAction({ action: 'resign' });
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && mode === 'online') Online.poll(); // telefona geri dönünce hemen tazele
});
$('#copy-link').onclick = () => {
  navigator.clipboard.writeText($('#room-link').value).then(() => {
    $('#copy-link').textContent = t('lobby.copied');
    setTimeout(() => ($('#copy-link').textContent = t('lobby.copy')), 1500);
  });
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.card && !modalOpen) { ui = { card: null, from: null }; render(); }
});

function showMenu() {
  if (S && !S.over && (mode === 'bot' || mode === 'online')) Analytics.track('game_abandon', { mode: gameKind(), moves: S.moveNo });
  if (mode === 'tutorial') Analytics.track('tutorial_exit', { lesson: Tutorial.lessonNo });
  S = null; // arkadaki oyunu durdur (bot ve saat)
  mode = 'bot';
  $('#coach').classList.add('hidden');
  document.body.classList.remove('tutorial');
  $('#btn-tutorial').classList.toggle('new', !Tutorial.isDone());
  $('#btn-resume').classList.toggle('hidden', !Online.storedSession());
  setNetStatus('');
  lobbyView('menu');
  $('#lobby-error').textContent = '';
}

// ---------- geri bildirim ve istatistik izni ----------
function openFeedback() {
  $('#fb').classList.remove('hidden');
  $('#fb-note').textContent = '';
  $('#fb-note').className = 'err';
  $('#fb-send').disabled = false;
  setTimeout(() => $('#fb-msg').focus(), 50);
}
$('#feedback-btn').onclick = $('#btn-feedback').onclick = openFeedback;
$('#fb-cancel').onclick = () => $('#fb').classList.add('hidden');
$('#fb-send').onclick = async () => {
  const msg = $('#fb-msg').value.trim();
  if (!msg) return ($('#fb-note').textContent = t('fb.empty'));
  $('#fb-send').disabled = true;
  const ok = await Analytics.feedback(msg, $('#fb-contact').value.trim(), { mode, moves: S ? S.moveNo : null });
  $('#fb-send').disabled = false;
  $('#fb-note').textContent = ok ? t('fb.thanks') : t('fb.fail');
  $('#fb-note').className = ok ? 'err ok' : 'err';
  if (ok) {
    $('#fb-msg').value = '';
    Analytics.track('feedback_sent');
    setTimeout(() => $('#fb').classList.add('hidden'), 1400);
  }
};

function showConsent() {
  $('#consent').classList.toggle('hidden', Analytics.consent() !== null);
  $('#btn-stats').textContent = t('footer.stats', { state: t(Analytics.consent() === 'yes' ? 'footer.on' : 'footer.off') });
}
$('#consent-yes').onclick = () => { Analytics.setConsent(true); showConsent(); };
$('#consent-no').onclick = () => { Analytics.setConsent(false); showConsent(); };
$('#btn-stats').onclick = () => { Analytics.setConsent(Analytics.consent() !== 'yes'); showConsent(); };
I18N.onChange(showConsent);
showConsent();

// ---------- mobil düzen: ortadaki kart ve deste, telefonda elin hemen üstüne taşınır ----------
const narrow = matchMedia('(max-width: 700px)');
function placeTableCenter() {
  const center = $('#table-center');
  const target = narrow.matches ? $('#mobile-slot') : $('aside');
  if (center.parentElement !== target) target.prepend(center);
}
narrow.addEventListener('change', placeTableCenter);
placeTableCenter();

// ---------- PWA: çevrimdışı önbellek ve yükleme ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('#btn-install').classList.remove('hidden');
});
$('#btn-install').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  Analytics.track('install', { outcome: choice && choice.outcome });
  installPrompt = null;
  $('#btn-install').classList.add('hidden');
};
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !standalone) $('#ios-install').classList.remove('hidden');

// Başlangıç: link ?oda=KOD içeriyorsa direkt katıl, yoksa menüyü göster
const linkCode = new URLSearchParams(location.search).get('oda');
const savedSession = Online.storedSession(!!linkCode); // davet linkiyle gelindiyse sadece bu sekmenin oturumu
if (savedSession && (!linkCode || savedSession.id === linkCode.toUpperCase())) resumeSession(savedSession);
else if (linkCode) joinRoom(linkCode);
else showMenu();
