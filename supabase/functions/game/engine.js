// Şahkart sunucu hakemi: online oyunların durumu burada değişir.
// İstemcideki game.js ile aynı durum biçimini kullanır, böylece arayüz aynen çizebilir.
import Rules from './rules.js';

const R = Rules;
const HAND_SIZE = 7;
const LOG_KEEP = 80;

export function parseTC(v) {
  const [base, inc] = String(v).split('+').map(Number);
  return base > 0 ? { base: base * 1000, inc: (inc || 0) * 1000 } : null;
}

function cardSymbol(card) {
  if (card.kind === 'piece') return R.GLYPH[card.piece] + '︎';
  if (card.kind === 'skip') return '⏭︎';
  if (card.kind === 'draw2') return '+2';
  return '★';
}
const cardTag = card => '<span class="tag ' + (card.kind === 'wild' ? 'wild' : 'c' + card.color) + '">' + cardSymbol(card) + '</span>';
const topCard = S => S.discard[S.discard.length - 1];

function log(S, m, s = -1, end = false) {
  S.log.push({ m, s, end });
  if (S.log.length > LOG_KEEP) S.log.splice(0, S.log.length - LOG_KEEP);
}
function fx(S, k) {
  S.sfx.push({ n: ++S.sfxN, k });
  if (S.sfx.length > 8) S.sfx.shift();
}

export function newGame(tc) {
  const deck = R.buildDeck();
  const S = {
    board: R.initialBoard(), deck, discard: [], hands: [[], []],
    activeColor: 0, turn: 0, over: false, winner: null, reason: '',
    lastMove: null, drawn: null, log: [],
    gameId: crypto.randomUUID().slice(0, 8), moveNo: 0, sfx: [], sfxN: 0, clock: null,
  };
  const t = parseTC(tc);
  if (t) S.clock = { ...t, left: [t.base, t.base], running: 0, since: null };
  for (let i = 0; i < HAND_SIZE; i++) { S.hands[0].push(deck.pop()); S.hands[1].push(deck.pop()); }
  const first = S.deck.splice(S.deck.findIndex(c => c.kind === 'piece'), 1)[0];
  S.discard.push(first);
  S.activeColor = first.color;
  log(S, 'Oyun başladı. İlk kart: ' + cardTag(first));
  startTurn(S);
  return S;
}

// ---------- saat ----------
function clockCharge(S, addInc) {
  const k = S.clock;
  if (!k || k.since == null) return;
  const now = Date.now();
  k.left[k.running] = Math.max(0, k.left[k.running] - (now - k.since));
  if (addInc) k.left[k.running] += k.inc;
  k.since = now;
}

// Süre bittiyse oyunu bitirir; durum değiştiyse true döner
export function checkTimeout(S) {
  const k = S.clock;
  if (!k || S.over || k.since == null) return false;
  if (k.left[k.running] - (Date.now() - k.since) > 0) return false;
  const loser = k.running;
  log(S, '{' + loser + '} süresi bitti!', 1 - loser, true);
  endGame(S, 1 - loser, 'Süre bitti');
  return true;
}

function startTurn(S) {
  if (S.over) return;
  const k = S.clock;
  if (k) {
    if (k.since == null) k.since = Date.now();
    else clockCharge(S, true);
    k.running = S.turn;
  }
  S.drawn = null;
}

function endGame(S, winner, reason) {
  clockCharge(S, false);
  if (S.clock) S.clock.since = null;
  S.over = true;
  S.winner = winner;
  S.reason = reason;
}

function drawCards(S, side, n) {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (!S.deck.length) {
      if (S.discard.length <= 1) break;
      const keep = S.discard.pop();
      S.deck = R.shuffle(S.discard);
      S.discard = [keep];
      log(S, 'Deste bitti, atılan kartlar karıştırıldı.');
    }
    S.hands[side].push(S.deck.pop());
    drawn++;
  }
  return drawn;
}

function play(S, side, opt, chosenColor) {
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
    fx(S, cap ? 'capture' : 'move');
    if (move.promo) fx(S, 'promo');
    text += ' → ' + R.GLYPH[piece.t] + '︎ ' + R.sqName(move.fr, move.fc) + '–' + R.sqName(move.tr, move.tc);
    if (cap) text += ' <b>(' + R.PIECE_NAMES[cap.t] + ' aldı)</b>';
    if (move.promo) text += ' — piyon vezir oldu!';
    if (cap && cap.t === 'k') {
      log(S, text, side, true);
      return endGame(S, side, 'Şah alındı');
    }
  }

  if (card.kind === 'wild') {
    S.activeColor = chosenColor;
    text += ' · yeni renk: <span class="dot c' + chosenColor + '"></span>' + R.COLOR_NAMES[chosenColor];
  } else {
    S.activeColor = card.color;
  }
  if (!move) fx(S, 'card');
  if (card.kind === 'skip') { again = true; text += ' — tekrar oynuyor'; fx(S, 'skip'); }
  if (card.kind === 'draw2') { const n = drawCards(S, opp, 2); text += ' — {' + opp + '} ' + n + ' kart çekti'; fx(S, 'penalty'); }
  if (R.zoneBonus(card, move)) { const n = drawCards(S, opp, 1); if (n) { text += ' — <i>renk bonusu</i>: {' + opp + '} 1 kart çekti'; fx(S, 'penalty'); } }

  log(S, text, side);
  if (!hand.length) { log(S, '{' + side + '} elindeki tüm kartları bitirdi!', side, true); return endGame(S, side, 'Elindeki tüm kartları bitirdi'); }

  S.turn = again ? side : opp;
  startTurn(S);
}

function drawCard(S, side) {
  const hand = S.hands[side];
  const n = drawCards(S, side, 1);
  if (!n) { log(S, '{' + side + '}: çekecek kart yok.', side); return passTurn(S, side); }
  fx(S, 'draw');
  const card = hand[hand.length - 1];
  const opts = R.cardOptions(S.board, side === 0, card, topCard(S), S.activeColor);
  if (!opts.length) {
    log(S, '{' + side + '} kart çekti ve sırasını geçti.', side);
    S.turn = 1 - side;
    return startTurn(S);
  }
  log(S, '{' + side + '} kart çekti.', side);
  S.drawn = card.id;
}

function passTurn(S, side) {
  if (S.drawn) log(S, '{' + side + '} sırasını geçti.', side);
  S.turn = 1 - side;
  startTurn(S);
}

// Oyuncu eylemini doğrula ve uygula. Hata varsa açıklama döner.
export function act(S, side, a) {
  if (checkTimeout(S)) return null;
  if (a.action === 'resign') {
    if (S.over) return 'Oyun zaten bitti.';
    log(S, '{' + side + '} pes etti.', 1 - side, true);
    endGame(S, 1 - side, 'Rakip pes etti');
    return null;
  }
  if (S.over) return 'Oyun bitti.';
  if (S.turn !== side) return 'Sıra sende değil.';
  if (a.action === 'draw') {
    if (S.drawn) return 'Zaten kart çektin.';
    drawCard(S, side);
    return null;
  }
  if (a.action === 'pass') {
    if (!S.drawn) return 'Önce kart çekmelisin.';
    passTurn(S, side);
    return null;
  }
  if (a.action === 'play') {
    const card = S.hands[side].find(c => c.id === a.cardId);
    if (!card) return 'Bu kart elinde yok.';
    if (S.drawn && card.id !== S.drawn) return 'Sadece çektiğin kartı oynayabilirsin.';
    const m = a.move;
    const opt = R.cardOptions(S.board, side === 0, card, topCard(S), S.activeColor).find(o =>
      !m ? !o.move : o.move && o.move.fr === m.fr && o.move.fc === m.fc && o.move.tr === m.tr && o.move.tc === m.tc);
    if (!opt) return 'Geçersiz hamle.';
    if (card.kind === 'wild' && !(Number.isInteger(a.color) && a.color >= 0 && a.color < 4)) return 'Renk seçilmedi.';
    play(S, side, opt, a.color);
    return null;
  }
  return 'Bilinmeyen eylem.';
}

// Oyuncunun görebileceği durum: rakibin eli gizli, deste sadece sayı
export function viewFor(S, side) {
  return {
    ...S,
    deck: S.deck.length,
    hands: S.hands.map((h, i) => (i === side ? h : h.map(c => ({ id: c.id })))),
    clock: S.clock && { ...S.clock, left: [...S.clock.left], el: S.clock.since == null ? 0 : Date.now() - S.clock.since },
  };
}
