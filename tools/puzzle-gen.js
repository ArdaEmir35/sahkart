// Bulmaca üretici (geliştirici aracı; oyunda yüklenmez).
// Kullanım: oyunu tarayıcıda aç, konsola bu dosyayı yapıştır, sonra:
//   PuzzleGen.buildPool(60); const out = PuzzleGen.run({ king1: 12, empty1: 6, king2: 12 }); copy(JSON.stringify(out))
// Mantık: bot-bot maçlarından gerçekçi pozisyonlar alır, rastgele eller dağıtır,
// Puzzles.solve ile çözülebilir + tek doğru ilk kart + yeterince zor olanları seçer.
const PuzzleGen = (() => {
  const C = 'RBGY';
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const rows = b => b.map(r => r.map(p => (p ? (p.w ? p.t.toUpperCase() : p.t) : '.')).join(''));
  const code = c => (c.kind === 'wild' ? 'W' : C[c.color] + (c.kind === 'skip' ? 's' : c.kind === 'draw2' ? 'd' : c.piece));

  // Bot-bot maçlarından pozisyon havuzu: her maçtan, sıra beyazdayken 8-45. hamleler arası anlık görüntüler
  let pool = [];
  function buildPool(games = 40) {
    for (let g = 0; g < games; g++) {
      const G = Core.newGame('0');
      S = G; // botun değerlendirmesi küresel S'yi kullanır
      let guard = 0;
      while (!G.over && G.moveNo < 45 && guard++ < 400) {
        if (G.turn === 0 && G.moveNo >= 8 && Rules.findKing(G.board, true) && Rules.findKing(G.board, false)
            && G.board.flat().filter(p => p && p.w).length >= 5) pool.push(Rules.cloneBoard(G.board));
        const side = G.turn, L = LEVELS.normal;
        const best = pickBest(Core.optionsFor(G, side), side, L);
        if (best) Core.act(G, side, { action: 'play', cardId: best.card.id, move: best.move, color: best.card.kind === 'wild' ? 0 : undefined });
        else { Core.act(G, side, { action: 'draw' }); if (G.drawn && G.turn === side) Core.act(G, side, { action: 'pass' }); }
      }
    }
    return pool.length;
  }
  const position = filter => {
    const c = filter ? pool.filter(filter) : pool;
    return c.length ? pick(c) : null;
  };

  const kingAttackers = b => {
    const k = Rules.findKing(b, false);
    return new Set(Rules.sideMoves(b, true).filter(m => m.tr === k[0] && m.tc === k[1]).map(m => b[m.fr][m.fc].t));
  };
  const randCard = (kinds, pieces) => {
    const k = pick(kinds);
    if (k === 'W') return 'W';
    return pick(C) + (k === 'p' ? pick(pieces) : k);
  };

  // Aday bulmacayı çöz ve değerlendir
  function judge(p) {
    const S = Puzzles.stateOf(p);
    const res = Puzzles.solve(S, p.g, p.n, 60);
    if (!res.lines.length) return null;
    const firsts = new Set(res.lines.map(l => l[0].cardId));
    if (firsts.size !== 1) return null;                       // tek doğru ilk kart
    if (p.n > 1) {                                             // 2 turluk: 1 turda çözülmemeli
      const one = Puzzles.solve(Puzzles.stateOf(p), p.g, 1, 1);
      if (one.lines.length) return null;
    }
    const minLen = Math.min(...res.lines.map(l => l.length));
    return { minLen, lines: res.lines.length, nodes: res.nodes };
  }

  // Tür 1: bu tur şahı al. Saldıran taşın kartı var ama renk zinciri gerekiyor.
  function king1() {
    for (let tries = 0; tries < 4000; tries++) {
      const b = position(x => kingAttackers(x).size > 0);
      if (!b) return null;
      const att = [...kingAttackers(b)];
      const others = ['p', 'n', 'b', 'r', 'q', 'k'].filter(x => !att.includes(x));
      const key = pick(C) + pick(att);
      const nSkips = 1 + Math.floor(Math.random() * 3);
      const hand = [key];
      for (let i = 0; i < nSkips; i++) hand.push(pick(C) + 's');
      for (let i = 0; i < 2; i++) hand.push(Math.random() < 0.3 ? pick(C) + 'd' : pick(C) + pick(others.length ? others : ['p']));
      const top = pick(C) + pick(others.length ? others : ['p']);
      const p = { g: 'king', n: 1, b: rows(b), t: top, h: hand.sort(() => Math.random() - 0.5) };
      const j = judge(p);
      if (j && j.minLen >= 2) return { ...p, j };
    }
  }

  // Tür 2: bu tur elindeki bütün kartları bitir (sıralama bulmacası)
  function empty1() {
    for (let tries = 0; tries < 4000; tries++) {
      const b = position();
      const att = kingAttackers(b);
      const safe = ['p', 'n', 'b', 'r', 'q'].filter(x => !att.has(x));
      if (!safe.length) continue;
      const n = 3 + Math.floor(Math.random() * 3);
      const hand = [];
      for (let i = 0; i < n - 1; i++) hand.push(pick(C) + 's');
      hand.push(pick(C) + pick(safe));
      if (Math.random() < 0.5) hand.push(pick(C) + 'd');          // tuzak: +2 sırayı bitirir
      const top = pick(C) + pick(safe);
      const p = { g: 'empty', n: 1, b: rows(b), t: top, h: hand.sort(() => Math.random() - 0.5) };
      const j = judge(p);
      if (j && j.minLen >= 3) return { ...p, j };
    }
  }

  // Tür 3: 2 turda şahı al (şu an saldıran yok; önce hazırlık hamlesi gerekiyor)
  function king2() {
    for (let tries = 0; tries < 3000; tries++) {
      const b = position(x => !kingAttackers(x).size);
      if (!b) return null;
      const n = 3 + Math.floor(Math.random() * 2);
      const hand = [];
      for (let i = 0; i < n; i++) hand.push(randCard(['p', 'p', 'p', 's', 'd'], ['n', 'b', 'r', 'q', 'p']));
      const top = pick(C) + pick(['p', 'n', 'b', 'r', 'q']);
      const p = { g: 'king', n: 2, b: rows(b), t: top, h: hand };
      const j = judge(p);
      if (j) return { ...p, j };
    }
  }

  function run(counts = { king1: 12, empty1: 6, king2: 12 }) {
    const out = [];
    const gens = { king1, empty1, king2 };
    for (const [k, n] of Object.entries(counts))
      for (let i = 0; i < n; i++) { const p = gens[k](); if (p) out.push(p); }
    return out;
  }

  return { run, king1, empty1, king2, judge, buildPool, get pool() { return pool; } };
})();
