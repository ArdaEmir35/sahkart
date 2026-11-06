// Şahkart / Chromate oyun çekirdeği: kuralları uygulayan, dilden bağımsız durum makinesi.
// Tarayıcıda (bot, eğitim) ve sunucuda (online) aynı dosya kullanılır.
// Kayıtlar metin değil olay kodu tutar ({k, p, s, end}); her oyuncu kendi dilinde okur.
const Core = (() => {
  const R = Rules;
  const HAND_SIZE = 7;
  const LOG_KEEP = 80;

  const cardOf = c => ({ kind: c.kind, color: c.color, piece: c.piece });
  const topCard = S => S.discard[S.discard.length - 1];

  function parseTC(v) {
    const [base, inc] = String(v).split('+').map(Number);
    return base > 0 ? { base: base * 1000, inc: (inc || 0) * 1000 } : null;
  }

  function log(S, k, p = {}, s = -1, end = false) {
    S.log.push({ k, p, s, end });
    if (S.log.length > LOG_KEEP) S.log.splice(0, S.log.length - LOG_KEEP);
  }
  // Ses olayları: durumla birlikte gider, iki tarafta da çalınır
  function fx(S, k) {
    S.sfx.push({ n: ++S.sfxN, k });
    if (S.sfx.length > 8) S.sfx.shift();
  }

  function emptyState() {
    return {
      board: R.initialBoard(), deck: [], discard: [], hands: [[], []],
      activeColor: 0, turn: 0, over: false, winner: null, reason: '',
      lastMove: null, drawn: null, log: [],
      gameId: Math.random().toString(36).slice(2, 10), moveNo: 0, sfx: [], sfxN: 0, clock: null,
    };
  }

  function newGame(tc) {
    const S = emptyState();
    S.deck = R.buildDeck();
    const t = parseTC(tc);
    if (t) S.clock = { ...t, left: [t.base, t.base], running: 0, since: null };
    for (let i = 0; i < HAND_SIZE; i++) { S.hands[0].push(S.deck.pop()); S.hands[1].push(S.deck.pop()); }
    const first = S.deck.splice(S.deck.findIndex(c => c.kind === 'piece'), 1)[0];
    S.discard.push(first);
    S.activeColor = first.color;
    log(S, 'start', { card: cardOf(first) });
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
  function checkTimeout(S) {
    const k = S.clock;
    if (!k || S.over || k.since == null) return false;
    if (k.left[k.running] - (Date.now() - k.since) > 0) return false;
    const loser = k.running;
    log(S, 'timeout', {}, loser, true);
    endGame(S, 1 - loser, 'time');
    return true;
  }

  function startTurn(S) {
    if (S.over) return;
    const k = S.clock;
    if (k) {
      if (k.since == null) k.since = Date.now(); // ilk hamle: saat başlar
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
    S.reason = reason; // 'king' | 'empty' | 'time' | 'resign'
  }

  function drawCards(S, side, n) {
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!S.deck.length) {
        if (S.discard.length <= 1) break;
        const keep = S.discard.pop();
        S.deck = R.shuffle(S.discard);
        S.discard = [keep];
        log(S, 'reshuffle');
      }
      S.hands[side].push(S.deck.pop());
      drawn++;
    }
    return drawn;
  }

  const optionsFor = (S, side) => R.allOptions(S.board, side === 0, S.hands[side], topCard(S), S.activeColor);
  const cardOptions = (S, side, card) => R.cardOptions(S.board, side === 0, card, topCard(S), S.activeColor);

  function play(S, side, opt, chosenColor) {
    const { card, move } = opt;
    const hand = S.hands[side];
    hand.splice(hand.findIndex(c => c.id === card.id), 1);
    S.discard.push(card);
    const opp = 1 - side;
    const p = { card: cardOf(card) };
    let again = false;

    if (move) {
      const piece = S.board[move.fr][move.fc];
      const cap = R.applyMove(S.board, move);
      S.lastMove = { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc, cap: !!cap };
      S.moveNo++;
      fx(S, cap ? 'capture' : 'move');
      if (move.promo) fx(S, 'promo');
      p.move = { piece: piece.t, from: R.sqName(move.fr, move.fc), to: R.sqName(move.tr, move.tc), cap: cap ? cap.t : null, promo: !!move.promo };
      if (cap && cap.t === 'k') {
        log(S, 'play', p, side, true);
        endGame(S, side, 'king');
        return;
      }
    }

    if (card.kind === 'wild') { S.activeColor = chosenColor; p.color = chosenColor; }
    else S.activeColor = card.color;
    if (!move) fx(S, 'card');
    if (card.kind === 'skip') { again = true; p.again = true; fx(S, 'skip'); }
    if (card.kind === 'draw2') { p.draw2 = drawCards(S, opp, 2); fx(S, 'penalty'); }
    if (R.zoneBonus(card, move)) { const n = drawCards(S, opp, 1); if (n) { p.bonus = n; fx(S, 'penalty'); } }

    log(S, 'play', p, side);
    if (!hand.length) { log(S, 'emptied', {}, side, true); endGame(S, side, 'empty'); return; }

    S.turn = again ? side : opp;
    startTurn(S);
  }

  // Desteden 1 kart çeker. Çekilen kart oynanabiliyorsa hemen oynanabilir, yoksa sıra geçer.
  function drawCard(S, side) {
    const hand = S.hands[side];
    const n = drawCards(S, side, 1);
    if (!n) { log(S, 'noCards', {}, side); passTurn(S, side); return; }
    fx(S, 'draw');
    const card = hand[hand.length - 1];
    if (!cardOptions(S, side, card).length) {
      log(S, 'drewPassed', {}, side);
      S.turn = 1 - side;
      startTurn(S);
      return;
    }
    log(S, 'drew', {}, side);
    S.drawn = card.id;
  }

  function passTurn(S, side) {
    if (S.drawn) log(S, 'passed', {}, side);
    S.turn = 1 - side;
    startTurn(S);
  }

  // Oyuncu eylemini doğrula ve uygula. Hata varsa hata kodu döner, yoksa null.
  // a = { action: 'play', cardId, move, color } | { action: 'draw' | 'pass' | 'resign' }
  function act(S, side, a) {
    if (checkTimeout(S)) return null;
    if (a.action === 'resign') {
      if (S.over) return 'over';
      log(S, 'resign', {}, side, true);
      endGame(S, 1 - side, 'resign');
      return null;
    }
    if (S.over) return 'over';
    if (S.turn !== side) return 'notTurn';
    if (a.action === 'draw') {
      if (S.drawn) return 'alreadyDrew';
      drawCard(S, side);
      return null;
    }
    if (a.action === 'pass') {
      if (!S.drawn) return 'mustDraw';
      passTurn(S, side);
      return null;
    }
    if (a.action === 'play') {
      const card = S.hands[side].find(c => c.id === a.cardId);
      if (!card) return 'noCard';
      if (S.drawn && card.id !== S.drawn) return 'onlyDrawn';
      const m = a.move;
      const opt = cardOptions(S, side, card).find(o =>
        !m ? !o.move : o.move && o.move.fr === m.fr && o.move.fc === m.fc && o.move.tr === m.tr && o.move.tc === m.tc);
      if (!opt) return 'illegal';
      if (card.kind === 'wild' && !(Number.isInteger(a.color) && a.color >= 0 && a.color < 4)) return 'noColor';
      play(S, side, opt, a.color);
      return null;
    }
    return 'unknown';
  }

  // Oyuncunun görebileceği durum: rakibin eli gizli, deste sadece sayı
  function viewFor(S, side) {
    return {
      ...S,
      deck: S.deck.length,
      hands: S.hands.map((h, i) => (i === side ? h : h.map(c => ({ id: c.id })))),
      clock: S.clock && { ...S.clock, left: [...S.clock.left], el: S.clock.since == null ? 0 : Date.now() - S.clock.since },
    };
  }

  return {
    parseTC, emptyState, newGame, act, checkTimeout, viewFor, startTurn, log,
    optionsFor, cardOptions, topCard,
  };
})();
