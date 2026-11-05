// Şahkart: oyun akışı, arayüz, bot ve online mod
const R = Rules;
const HAND_SIZE = 7;

// mode: 'bot' (bota karşı), 'host' (odayı açan, oyunu yöneten), 'guest' (odaya katılan)
let mode = 'bot';
let ME = 0;            // bu tarayıcıdaki oyuncu: 0 = beyaz, 1 = siyah
let S = null;          // oyun durumu (guest'te host'tan gelen kopya)
let ui = { card: null, from: null };
let botDelay = 800, botBusy = false, modalOpen = false, pending = false, rematchAsked = false;
let roomCode = '';
let recvAt = 0;        // guest: son durumun geldiği an (saat hesabı için)

// Süre ayarı: "saniye+artış" (ör. "300+3"), "0" = süresiz
let timeControl = localStorage.getItem('sahkart-tc') || '300+3';
function parseTC(v) {
  const [base, inc] = String(v).split('+').map(Number);
  return base > 0 ? { base: base * 1000, inc: (inc || 0) * 1000 } : null;
}

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isWhite = side => side === 0;
const nameOf = side => (side === ME ? 'Sen' : mode === 'bot' ? 'Bot (' + LEVELS[botLevel].name + ')' : mode === 'tutorial' ? 'Bot' : 'Rakip');
const topCard = () => S.discard[S.discard.length - 1];

// ---------- oyun mantığı (sadece bot modunda ve host'ta çalışır) ----------
function newGame() {
  const deck = R.buildDeck();
  S = {
    board: R.initialBoard(), deck, discard: [], hands: [[], []],
    activeColor: 0, turn: 0, over: false, winner: null, reason: '',
    lastMove: null, drawn: null, log: [],
    gameId: Math.random().toString(36).slice(2, 8), moveNo: 0, sfx: [], sfxN: 0,
    clock: null,
  };
  const tc = parseTC(timeControl);
  if (tc) S.clock = { ...tc, left: [tc.base, tc.base], running: 0, since: null };
  for (let i = 0; i < HAND_SIZE; i++) { S.hands[0].push(deck.pop()); S.hands[1].push(deck.pop()); }
  const first = S.deck.splice(S.deck.findIndex(c => c.kind === 'piece'), 1)[0];
  S.discard.push(first);
  S.activeColor = first.color;
  rematchAsked = false;
  botBusy = false;
  log('Oyun başladı. İlk kart: ' + cardTag(first));
  startTurn();
}

// Log satırlarında {0}/{1}, her oyuncunun ekranında "Sen" / "Rakip" olarak gösterilir
function log(msg, side = -1, end = false) {
  S.log.push({ m: msg, s: side, end });
}

// Ses olayları: durumla birlikte gönderilir, iki tarafta da çalınır
function fx(k) {
  S.sfx.push({ n: ++S.sfxN, k });
  if (S.sfx.length > 8) S.sfx.shift();
}

// ---------- satranç saati ----------
// Sırası biten tarafın süresinden geçen zamanı düş; hamle yaptıysa artışı ekle
function clockCharge(addInc) {
  const k = S.clock;
  if (!k || k.since == null) return;
  const now = Date.now();
  k.left[k.running] = Math.max(0, k.left[k.running] - (now - k.since));
  if (addInc) k.left[k.running] += k.inc;
  k.since = now;
}

function clockLeft(i) {
  const k = S.clock;
  let t = k.left[i];
  if (k.since != null && i === k.running && !S.over)
    t -= mode === 'guest' ? k.el + (Date.now() - recvAt) : Date.now() - k.since;
  return Math.max(0, t);
}

function drawCards(side, n) {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (!S.deck.length) {
      if (S.discard.length <= 1) break;
      const keep = S.discard.pop();
      S.deck = R.shuffle(S.discard);
      S.discard = [keep];
      log('Deste bitti, atılan kartlar karıştırıldı.');
    }
    S.hands[side].push(S.deck.pop());
    drawn++;
  }
  return drawn;
}

function optionsFor(side) {
  return R.allOptions(S.board, isWhite(side), S.hands[side], topCard(), S.activeColor);
}

function startTurn() {
  if (S.over) return sync();
  const k = S.clock;
  if (k) {
    if (k.since == null) k.since = Date.now(); // ilk hamle: saat başlar
    else clockCharge(true);
    k.running = S.turn;
  }
  ui = { card: null, from: null };
  S.drawn = null;
  sync();
  if (mode === 'bot' && S.turn === 1) botTurn();
}

// Durumu ekrana çiz, host isek rakibe gönder
function sync() {
  render();
  if (mode === 'host') Net.send({ a: 'state', s: viewFor(1) });
}

// Rakibin elini gizleyerek durumun bir kopyasını hazırla
function viewFor(side) {
  return {
    ...S,
    deck: S.deck.length,
    clock: S.clock && { ...S.clock, left: [...S.clock.left], el: S.clock.since == null ? 0 : Date.now() - S.clock.since },
    hands: S.hands.map((h, i) => (i === side ? h : h.map(c => ({ id: c.id })))),
  };
}

function play(side, opt, chosenColor) {
  const { card, move } = opt;
  const hand = S.hands[side];
  hand.splice(hand.findIndex(c => c.id === card.id), 1);
  S.discard.push(card);
  const opp = 1 - side;
  let again = false;
  let text = '{' + side + '}: ' + cardTag(card);

  if (move) {
    const piece = S.board[move.fr][move.fc];
    const cap = R.applyMove(S.board, move);
    S.lastMove = { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc, cap: !!cap };
    S.moveNo++;
    fx(cap ? 'capture' : 'move');
    if (move.promo) fx('promo');
    text += ' → ' + R.GLYPH[piece.t] + '︎ ' + R.sqName(move.fr, move.fc) + '–' + R.sqName(move.tr, move.tc);
    if (cap) text += ' <b>(' + R.PIECE_NAMES[cap.t] + ' aldı)</b>';
    if (move.promo) text += ' — piyon vezir oldu!';
    if (cap && cap.t === 'k') {
      log(text, side, true);
      return endGame(side, 'Şah alındı');
    }
  }

  if (card.kind === 'wild') {
    S.activeColor = chosenColor;
    text += ' · yeni renk: <span class="dot c' + chosenColor + '"></span>' + R.COLOR_NAMES[chosenColor];
  } else {
    S.activeColor = card.color;
  }
  if (!move) fx('card');
  if (card.kind === 'skip') { again = true; text += ' — tekrar oynuyor'; fx('skip'); }
  if (card.kind === 'draw2') { const n = drawCards(opp, 2); text += ' — {' + opp + '} ' + n + ' kart çekti'; fx('penalty'); }
  if (R.zoneBonus(card, move)) { const n = drawCards(opp, 1); if (n) { text += ' — <i>renk bonusu</i>: {' + opp + '} 1 kart çekti'; fx('penalty'); } }

  log(text, side);
  if (!hand.length) { log('{' + side + '} elindeki tüm kartları bitirdi!', side, true); return endGame(side, 'Elindeki tüm kartları bitirdi'); }

  S.turn = again ? side : opp;
  startTurn();
}

// Desteden 1 kart çeker. Çekilen kart oynanabiliyorsa hemen oynanabilir, yoksa sıra geçer.
function drawCard(side) {
  const hand = S.hands[side];
  const n = drawCards(side, 1);
  if (!n) { log('{' + side + '}: çekecek kart yok.', side); return passTurn(side); }
  fx('draw');
  const card = hand[hand.length - 1];
  const opts = R.cardOptions(S.board, isWhite(side), card, topCard(), S.activeColor);
  if (!opts.length) {
    log('{' + side + '} kart çekti ve sırasını geçti.', side);
    S.turn = 1 - side;
    return startTurn();
  }
  log('{' + side + '} kart çekti.', side);
  S.drawn = card.id;
  if (mode === 'bot' && side === 1) return botAfterDraw(opts);
  ui = { card: null, from: null };
  sync();
}

function passTurn(side) {
  if (S.drawn) log('{' + side + '} sırasını geçti.', side);
  S.turn = 1 - side;
  startTurn();
}

function endGame(winner, reason) {
  clockCharge(false);
  if (S.clock) S.clock.since = null;
  S.over = true;
  S.winner = winner;
  S.reason = reason;
  sync();
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
    play(ME, opt, color);
    return Tutorial.advance();
  }
  if (mode === 'guest') {
    pending = true;
    const m = opt.move;
    Net.send({ a: 'play', cardId: opt.card.id, move: m && { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc }, color });
    ui = { card: null, from: null };
    return render();
  }
  play(ME, opt, color);
}

function doDrawOrPass() {
  if (!canAct()) return;
  if (mode === 'tutorial') {
    const type = S.drawn ? 'pass' : 'draw';
    const err = Tutorial.check({ type });
    if (err) return flash(err);
    if (type === 'pass') passTurn(ME); else drawCard(ME);
    return Tutorial.advance();
  }
  if (mode === 'guest') { pending = true; Net.send({ a: S.drawn ? 'pass' : 'draw' }); return render(); }
  if (S.drawn) passTurn(ME); else drawCard(ME);
}

function doRematch() {
  if (mode === 'guest') { rematchAsked = true; Net.send({ a: 'rematch' }); return render(); }
  newGame();
}

// Host: misafirden gelen mesajları doğrula ve uygula
function onGuestMessage(m) {
  if (!m || !S) return;
  if (m.a === 'rematch') { if (S.over) newGame(); return; }
  if (S.over || S.turn !== 1) return sync();
  if (m.a === 'draw' && !S.drawn) return drawCard(1);
  if (m.a === 'pass' && S.drawn) return passTurn(1);
  if (m.a === 'play') {
    const card = S.hands[1].find(c => c.id === m.cardId);
    if (!card || (S.drawn && card.id !== S.drawn)) return sync();
    const opt = R.cardOptions(S.board, false, card, topCard(), S.activeColor).find(o =>
      !m.move ? !o.move : o.move && o.move.fr === m.move.fr && o.move.fc === m.move.fc && o.move.tr === m.move.tr && o.move.tc === m.move.tc);
    if (!opt) return sync();
    if (card.kind === 'wild' && !(m.color >= 0 && m.color < 4)) return sync();
    return play(1, opt, m.color);
  }
  sync();
}

// Guest: host'tan gelen durum
function onHostMessage(m) {
  if (m.a === 'full') { Net.close(); return lobbyError('Bu oda dolu.'); }
  if (m.a !== 'state') return;
  const turnChanged = !S || S.turn !== m.s.turn || S.over !== m.s.over;
  S = m.s;
  S.deck = new Array(m.s.deck);
  recvAt = Date.now();
  pending = false;
  if (!S.over) rematchAsked = false;
  if (turnChanged || S.drawn) ui = { card: null, from: null };
  render();
}

// ---------- insan arayüzü ----------
function myOptions(card) {
  return R.cardOptions(S.board, isWhite(ME), card, topCard(), S.activeColor);
}

function onCardClick(card) {
  if (!canAct()) return;
  if (S.drawn && card.id !== S.drawn) return flash('Sadece çektiğin kartı oynayabilir ya da pas geçebilirsin.');
  const opts = myOptions(card);
  if (!opts.length) return flash(R.matches(card, topCard(), S.activeColor)
    ? 'Bu kartla yapılabilecek bir hamle yok.'
    : 'Bu kart eşleşmiyor: renk veya sembol aynı olmalı.');
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
  easy:   { name: 'Kolay', noise: 2.2, blunder: 0.45, hang: 0.15, king: 3,  drawBelow: -4,   smart: false },
  normal: { name: 'Orta',  noise: 0.35, blunder: 0, hang: 0.75, king: 25, drawBelow: -1.2, smart: false },
  hard:   { name: 'Zor',   noise: 0.05, blunder: 0, hang: 0.95, king: 32, drawBelow: -0.8, smart: true },
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
  if (!best) return drawCard(1);
  playBot(best, 1, LEVELS[botLevel]);
}

async function botAfterDraw(opts) {
  const game = S;
  botBusy = true;
  render();
  await sleep(botDelay * 0.6);
  if (S !== game) return;
  botBusy = false;
  if (S.over || mode !== 'bot') return;
  const best = pickBest(opts, 1, LEVELS[botLevel], true);
  if (best) playBot(best, 1, LEVELS[botLevel]); else passTurn(1);
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
  play(side, opt, color);
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
  const label = card.kind === 'piece' ? R.PIECE_NAMES[card.piece] : card.kind === 'skip' ? 'Atla' : card.kind === 'draw2' ? 'Çek 2' : 'Joker';
  d.innerHTML = '<span class="corner">' + cardSymbol(card) + '</span><span class="sym">' + cardSymbol(card) + '</span><span class="lbl">' + label + '</span>';
  d.title = R.cardLabel(card);
  return d;
}

let renderedLogLen = 0;
function renderLog() {
  const box = $('#log');
  box.innerHTML = '';
  S.log.forEach(e => {
    const el = document.createElement('div');
    const cls = e.s < 0 ? 'sys' : e.end ? (S.winner === ME ? 'win' : 'lose') : e.s === ME ? 'me' : 'bot';
    el.className = 'log-line ' + cls;
    el.innerHTML = e.m.replace(/\{([01])\}/g, (_, d) => nameOf(+d));
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
  const t = Math.ceil(ms / 1000);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
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
  // Süre bitti mi? (oyunu yöneten taraf karar verir)
  if (mode !== 'guest' && !S.over && k.since != null && clockLeft(k.running) <= 0) {
    const loser = k.running;
    log('{' + loser + '} süresi bitti!', 1 - loser, true);
    endGame(1 - loser, 'Süre bitti');
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
  $('#opp-label').textContent = nameOf(OPP) + ' · ' + S.hands[OPP].length + ' kart';

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
  $('#deck-count').textContent = S.deck.length;
  const ac = $('#active-color');
  ac.className = 'active-color c' + S.activeColor;
  ac.textContent = R.COLOR_NAMES[S.activeColor];
  $('#draw-btn').disabled = !active;
  $('#draw-btn').classList.toggle('hint', !!tutHint.deck);
  $('#coach').classList.toggle('hidden', mode !== 'tutorial');
  document.body.classList.toggle('tutorial', mode === 'tutorial');
  if (mode === 'tutorial') Tutorial.renderCoach();
  $('#draw-label').textContent = S.turn === ME && S.drawn ? 'Pas geç' : 'Kart çek';

  // Durum
  const st = $('#status');
  if (!st.classList.contains('warn')) {
    if (mode === 'tutorial') st.textContent = '';
    else if (S.over) st.textContent = S.winner === ME ? 'Kazandın!' : nameOf(S.winner) + ' kazandı.';
    else if (S.turn !== ME) st.textContent = mode === 'bot' ? 'Bot düşünüyor…' : 'Rakibin sırası…';
    else if (pending) st.textContent = 'Gönderiliyor…';
    else if (!ui.card && S.drawn) st.textContent = 'Çektiğin kartı oynayabilir ya da pas geçebilirsin.';
    else if (!ui.card) st.textContent = optionsFor(ME).length ? 'Sıra sende: parlayan bir kart seç.' : 'Oynanabilir kartın yok: desteden çek.';
    else if (!ui.from) st.textContent = ui.card.kind === 'wild' ? 'Joker: istediğin taşı seç.' : R.PIECE_NAMES[ui.card.piece] + ' seç. ' + R.COLOR_NAMES[ui.card.color] + ' şeride gidersen rakip 1 kart çeker.';
    else st.textContent = 'Hedef kareyi seç.';
  }
  $('#turn-me').classList.toggle('on', S.turn === ME && !S.over);
  $('#turn-opp').classList.toggle('on', S.turn === OPP && !S.over);

  // Pencereler: renk seçimi / oyun sonu
  $('#overlay').classList.toggle('hidden', !modalOpen && (!S.over || mode === 'tutorial'));
  $('#color-pick').classList.toggle('hidden', !modalOpen);
  $('#result').classList.toggle('hidden', !S.over || modalOpen || mode === 'tutorial');
  if (S.over) {
    $('#overlay-title').textContent = S.winner === ME ? 'Kazandın! 🏆' : 'Kaybettin';
    $('#overlay-text').textContent = S.reason + '.';
    $('#again').textContent = rematchAsked ? 'Rakip bekleniyor…' : 'Tekrar Oyna';
    $('#again').disabled = rematchAsked;
  }
  renderLog();
  updateClocks();
}

// ---------- lobi ----------
function lobbyView(v) {
  $('#lobby').classList.remove('hidden');
  ['menu', 'hosting', 'joining'].forEach(x => $('#lobby-' + x).classList.toggle('hidden', x !== v));
}
function hideLobby() { $('#lobby').classList.add('hidden'); }
function lobbyError(msg) {
  mode = 'bot'; ME = 0;
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

function hostRoom() {
  if (!Net.available()) return lobbyError('Online mod yüklenemedi. İnternet bağlantını kontrol et.');
  mode = 'host'; ME = 0;
  lobbyView('hosting');
  $('#room-code').textContent = '····';
  $('#room-link').value = '';
  Net.host({
    onCode: code => {
      roomCode = code;
      $('#room-code').textContent = code;
      $('#room-link').value = location.origin + location.pathname + '?oda=' + code;
    },
    onConnect: () => {
      hideLobby();
      setNetStatus('● Bağlı · Oda ' + roomCode, true);
      newGame();
    },
    onMessage: onGuestMessage,
    onClose: () => setNetStatus('● Rakibin bağlantısı koptu', false),
    onError: e => lobbyError('Bağlantı hatası: ' + (e.type || e.message || e)),
  });
}

let joinTimer;
function joinRoom(code) {
  code = (code || '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) return lobbyError('4 harfli oda kodunu gir.');
  if (!Net.available()) return lobbyError('Online mod yüklenemedi. İnternet bağlantını kontrol et.');
  mode = 'guest'; ME = 1; roomCode = code;
  lobbyView('joining');
  $('#joining-code').textContent = code;
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => { if (!S) { Net.close(); lobbyError('Odaya bağlanılamadı. Kodu kontrol et.'); } }, 15000);
  Net.join(code, {
    onConnect: () => {
      clearTimeout(joinTimer);
      hideLobby();
      setNetStatus('● Bağlı · Oda ' + code, true);
    },
    onMessage: onHostMessage,
    onClose: () => setNetStatus('● Ev sahibinin bağlantısı koptu', false),
    onError: e => {
      clearTimeout(joinTimer);
      Net.close();
      lobbyError(e.type === 'peer-unavailable' ? 'Bu kodla açık bir oda bulunamadı.' : 'Bağlantı hatası: ' + (e.type || e.message || e));
    },
  });
}

// ---------- olaylar ----------
$('#draw-btn').onclick = doDrawOrPass;
$('#again').onclick = doRematch;
$('#new-game').onclick = () => {
  if (mode === 'tutorial') return showMenu();
  if (mode === 'bot') return S && !S.over && S.log.length > 2 && !confirm('Yeni oyuna başlansın mı?') ? null : showMenu();
  if (confirm('Online oyundan çıkıp menüye dönülsün mü?')) location.href = location.pathname;
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
const tcSel = $('#time-ctrl');
tcSel.value = timeControl;
if (tcSel.value !== timeControl) tcSel.value = timeControl = '300+3';
tcSel.onchange = () => { timeControl = tcSel.value; localStorage.setItem('sahkart-tc', timeControl); };
const soundBtn = $('#sound-btn');
const showSound = () => { soundBtn.textContent = Sound.isMuted() ? '🔇' : '🔊'; soundBtn.title = Sound.isMuted() ? 'Sesi aç' : 'Sesi kapat'; };
soundBtn.onclick = () => { Sound.setMuted(!Sound.isMuted()); showSound(); if (!Sound.isMuted()) Sound.play('move'); };
showSound();
$('#rules-btn').onclick = () => $('#rules').classList.toggle('hidden');
$('#btn-bot').onclick = startBotGame;
$('#btn-tutorial').onclick = startTutorial;
$('#coach-next').onclick = () => Tutorial.next();
$('#coach-exit').onclick = showMenu;
$('#btn-host').onclick = hostRoom;
$('#btn-join').onclick = () => joinRoom($('#join-code').value);
$('#join-code').onkeydown = e => { if (e.key === 'Enter') joinRoom(e.target.value); };
$('#cancel-host').onclick = $('#cancel-join').onclick = () => { Net.close(); lobbyError(''); };
$('#copy-link').onclick = () => {
  navigator.clipboard.writeText($('#room-link').value).then(() => {
    $('#copy-link').textContent = 'Kopyalandı ✓';
    setTimeout(() => ($('#copy-link').textContent = 'Linki kopyala'), 1500);
  });
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.card && !modalOpen) { ui = { card: null, from: null }; render(); }
});

function showMenu() {
  S = null; // arkadaki oyunu durdur (bot ve saat)
  mode = 'bot';
  $('#coach').classList.add('hidden');
  document.body.classList.remove('tutorial');
  $('#btn-tutorial').classList.toggle('new', !Tutorial.isDone());
  lobbyView('menu');
  $('#lobby-error').textContent = '';
}

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
  await installPrompt.userChoice;
  installPrompt = null;
  $('#btn-install').classList.add('hidden');
};
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !standalone) $('#ios-install').classList.remove('hidden');

// Başlangıç: link ?oda=KOD içeriyorsa direkt katıl, yoksa menüyü göster
const linkCode = new URLSearchParams(location.search).get('oda');
if (linkCode) joinRoom(linkCode); else showMenu();
