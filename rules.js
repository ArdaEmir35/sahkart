// Şahkart kuralları: tahta, taş hamleleri, deste ve kart eşleştirme
const Rules = (() => {
  const COLOR_NAMES = ['Kırmızı', 'Mavi', 'Yeşil', 'Sarı'];
  const PIECE_NAMES = { p: 'Piyon', n: 'At', b: 'Fil', r: 'Kale', q: 'Vezir', k: 'Şah' };
  const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
  const VALUE = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 100 };
  const FILES = 'abcdefgh';

  // Sütun -> renk şeridi (a-b kırmızı, c-d mavi, e-f yeşil, g-h sarı)
  const zone = c => c >> 1;
  const sqName = (r, c) => FILES[c] + (8 - r);

  function initialBoard() {
    const b = Array.from({ length: 8 }, () => Array(8).fill(null));
    const back = 'rnbqkbnr';
    for (let c = 0; c < 8; c++) {
      b[0][c] = { t: back[c], w: false };
      b[1][c] = { t: 'p', w: false };
      b[6][c] = { t: 'p', w: true };
      b[7][c] = { t: back[c], w: true };
    }
    return b;
  }

  const cloneBoard = b => b.map(row => row.map(p => (p ? { ...p } : null)));
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Şah kuralı yok: şah tehdit altına girebilir, şahı alan kazanır
  function pieceMoves(b, r, c) {
    const p = b[r][c];
    if (!p) return [];
    const out = [];
    const push = (tr, tc) => out.push({ fr: r, fc: c, tr, tc });
    const canLand = (tr, tc) => inside(tr, tc) && (!b[tr][tc] || b[tr][tc].w !== p.w);

    if (p.t === 'p') {
      const dir = p.w ? -1 : 1;
      const start = p.w ? 6 : 1;
      if (inside(r + dir, c) && !b[r + dir][c]) {
        push(r + dir, c);
        if (r === start && !b[r + 2 * dir][c]) push(r + 2 * dir, c);
      }
      for (const dc of [-1, 1]) {
        const tr = r + dir, tc = c + dc;
        if (inside(tr, tc) && b[tr][tc] && b[tr][tc].w !== p.w) push(tr, tc);
      }
    } else if (p.t === 'n' || p.t === 'k') {
      for (const [dr, dc] of p.t === 'n' ? KNIGHT : KING) {
        if (canLand(r + dr, c + dc)) push(r + dr, c + dc);
      }
    } else {
      const dirs = p.t === 'b' ? DIAG : p.t === 'r' ? ORTHO : DIAG.concat(ORTHO);
      for (const [dr, dc] of dirs) {
        let tr = r + dr, tc = c + dc;
        while (inside(tr, tc)) {
          if (b[tr][tc]) {
            if (b[tr][tc].w !== p.w) push(tr, tc);
            break;
          }
          push(tr, tc);
          tr += dr; tc += dc;
        }
      }
    }
    return out;
  }

  function sideMoves(b, white, type) {
    const out = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (p && p.w === white && (!type || p.t === type)) out.push(...pieceMoves(b, r, c));
      }
    return out;
  }

  // (r,c) karesine saldıran 'white' tarafının en düşük değerli taşı (yoksa 0)
  function minAttacker(b, r, c, white) {
    const t = cloneBoard(b);
    t[r][c] = { t: 'x', w: !white };
    let min = 0;
    for (const m of sideMoves(t, white)) {
      if (m.tr === r && m.tc === c) {
        const v = VALUE[t[m.fr][m.fc].t];
        if (!min || v < min) min = v;
      }
    }
    return min;
  }

  function findKing(b, white) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (b[r][c] && b[r][c].t === 'k' && b[r][c].w === white) return [r, c];
    return null;
  }

  // Hamleyi uygular, alınan taşı döndürür. Son sıraya ulaşan piyon vezir olur.
  function applyMove(b, m) {
    const p = b[m.fr][m.fc];
    const cap = b[m.tr][m.tc];
    b[m.tr][m.tc] = p;
    b[m.fr][m.fc] = null;
    if (p.t === 'p' && (m.tr === 0 || m.tr === 7)) {
      b[m.tr][m.tc] = { t: 'q', w: p.w };
      m.promo = true;
    }
    return cap;
  }

  // ---------- Kartlar ----------
  let nextId = 1;
  function buildDeck() {
    const d = [];
    const perColor = { p: 3, n: 2, b: 2, r: 2, q: 1, k: 1 };
    for (let color = 0; color < 4; color++) {
      for (const [piece, n] of Object.entries(perColor))
        for (let i = 0; i < n; i++) d.push({ id: nextId++, kind: 'piece', color, piece });
      d.push({ id: nextId++, kind: 'skip', color });
      d.push({ id: nextId++, kind: 'draw2', color });
    }
    for (let i = 0; i < 4; i++) d.push({ id: nextId++, kind: 'wild', color: null });
    return shuffle(d);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const sym = card => (card.kind === 'piece' ? card.piece : card.kind);

  // Kart, ortadaki kartla renk ya da sembol olarak eşleşiyor mu?
  function matches(card, top, activeColor) {
    if (card.kind === 'wild') return true;
    if (card.color === activeColor) return true;
    return top.kind !== 'wild' && sym(card) === sym(top);
  }

  // Bir kart için oynanabilir seçenekler: [{card, move?}]
  function cardOptions(b, white, card, top, activeColor) {
    if (!matches(card, top, activeColor)) return [];
    if (card.kind === 'skip' || card.kind === 'draw2') return [{ card }];
    if (card.kind === 'wild') return sideMoves(b, white).map(move => ({ card, move }));
    return sideMoves(b, white, card.piece).map(move => ({ card, move }));
  }

  // Renk bonusu: taş, kartın rengindeki şeride giderse rakip 1 kart çeker
  const zoneBonus = (card, move) => card.kind === 'piece' && !!move && zone(move.tc) === card.color;

  function allOptions(b, white, hand, top, activeColor) {
    return hand.flatMap(card => cardOptions(b, white, card, top, activeColor));
  }

  function cardLabel(card) {
    if (card.kind === 'wild') return 'Joker';
    const col = COLOR_NAMES[card.color];
    if (card.kind === 'skip') return col + ' Atla';
    if (card.kind === 'draw2') return col + ' +2';
    return col + ' ' + PIECE_NAMES[card.piece];
  }

  return {
    COLOR_NAMES, PIECE_NAMES, GLYPH, VALUE, zone, sqName,
    initialBoard, cloneBoard, pieceMoves, sideMoves, minAttacker, findKing, applyMove,
    buildDeck, shuffle, sym, matches, cardOptions, zoneBonus, allOptions, cardLabel,
  };
})();
