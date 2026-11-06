// Bulmacalar: hazır pozisyonda bir görevi çöz ("bu tur şahı al", "2 turda şahı al", "bu tur elini bitir").
// Bulmacalar tools/puzzle-gen.js ile üretildi ve aşağıdaki çözücüyle doğrulandı:
// her biri çözülebilir ve tek bir doğru ilk kartı var.
const Puzzles = (() => {
  const COLORS = 'RBGY';
  // Kart kodu: renk + tür. p n b r q k = taş, s = Atla, d = +2. "W" = Joker. Örn: "Rq" kırmızı vezir, "Bs" mavi atla
  function card(code, id) {
    if (code === 'W') return { id, kind: 'wild', color: null };
    const color = COLORS.indexOf(code[0]), x = code[1];
    if (x === 's') return { id, kind: 'skip', color };
    if (x === 'd') return { id, kind: 'draw2', color };
    return { id, kind: 'piece', color, piece: x };
  }
  const boardFrom = rows => rows.map(row => [...row].map(ch => (ch === '.' ? null : { t: ch.toLowerCase(), w: ch === ch.toUpperCase() })));

  // Bulmacanın başlangıç durumu (oyuncu beyaz, sıra onda)
  function stateOf(p) {
    const S = Core.emptyState();
    S.board = boardFrom(p.b);
    S.hands = [p.h.map((c, i) => card(c, i + 1)), Array.from({ length: 5 }, (_, i) => card('Rp', 100 + i))];
    const top = card(p.t, 99);
    S.discard = [top];
    S.activeColor = top.color;
    S.deck = [];
    Core.startTurn(S);
    return S;
  }

  // Çözücü: bütün kart sıralarını dener. Rakip ara turlarda oynayamaz (pas geçer).
  // goal: 'king' (şahı al) | 'empty' (elini bitir), turns: kaç turun var
  function solve(S0, goal, turns, limit = 50) {
    const out = { lines: [], nodes: 0 };
    (function rec(S, turnsLeft, line) {
      if (out.lines.length >= limit || out.nodes > 300000) return;
      for (const o of Core.optionsFor(S, 0)) {
        for (const color of o.card.kind === 'wild' ? [0, 1, 2, 3] : [undefined]) {
          out.nodes++;
          const S2 = structuredClone(S);
          const a = { action: 'play', cardId: o.card.id, move: o.move && { fr: o.move.fr, fc: o.move.fc, tr: o.move.tr, tc: o.move.tc }, color };
          Core.act(S2, 0, a);
          const l2 = line.concat([a]);
          if (S2.over) { if (S2.winner === 0 && S2.reason === goal) out.lines.push(l2); continue; }
          if (S2.turn === 0) rec(S2, turnsLeft, l2);
          else if (turnsLeft > 1) { S2.turn = 0; Core.startTurn(S2); rec(S2, turnsLeft - 1, l2); }
        }
      }
    })(S0, turns, []);
    return out;
  }

  // ---------- bulmaca listesi (tools/puzzle-gen.js çıktısı) ----------
  const LIST = [
    {"id":"p01","g":"king","n":1,"d":1,"b":["rnbqk.nr","pp.p.Bpp","..p.....","..b.p...","....P...","........","PPPPQPPP","R.B.K.NR"],"t":"Rk","h":["Rd","Yd","Bs","Bb","Rs"]},
    {"id":"p02","g":"king","n":1,"d":1,"b":["r..k.bnr","p...p.qp",".pp.N.p.",".n...P..",".P.p..P.","........","P.PP.P.P",".RB.QK.R"],"t":"Gr","h":["Gs","Rs","Rd","Rn","Ys","Bd"]},
    {"id":"p03","g":"empty","n":1,"d":1,"b":["..q.kbr.","rbpp.ppp",".p...p..","p.......",".nPP....","....N..P","PP..PPP.","RQ.K.BNR"],"t":"Bb","h":["Ys","Rn","Rs","Bs"]},
    {"id":"p04","g":"king","n":1,"d":1,"b":["..b..k.r",".p.p...p","r....bp.","pNBnp..q","....pP..","......Q.","PPP.PKPP",".R...BNR"],"t":"Yr","h":["Rb","Gs","Ys","Rs","Yr","Yk"]},
    {"id":"p05","g":"king","n":1,"d":1,"b":[".nbq..nr","rppp.kpp","p..b....","....Np.P","........","..N....R","PPPPPPP.",".RBQKB.."],"t":"Br","h":["Rd","Bd","Rs","Bs","Rn"]},
    {"id":"p06","g":"empty","n":1,"d":1,"b":["rn.q.br.","p....ppp","...pk...",".Qp.p...","...P....","P.N.P..N",".PP..PPP","R.B.KR.."],"t":"Rn","h":["Gs","Rs","Gp"]},
    {"id":"p07","g":"king","n":1,"d":1,"b":["rnbq.k..","pppp...p",".....prn","b..Np.p.","..P....P","BP.....N","P..PPPP.",".R.QKB.R"],"t":"Yp","h":["Rs","Bs","Bb","Yr","Ys","Yk"]},
    {"id":"p08","g":"king","n":1,"d":1,"b":["rnb..br.","pppqpkpp","...p.p.n","........",".PB.P...","N....N.P","P.PP.PP.","R.BQK..R"],"t":"Bk","h":["Ys","Yd","Yd","Bs","Rs","Yb"]},
    {"id":"p09","g":"empty","n":1,"d":1,"b":["r.b.k...","...pbpp.","p...p.r.",".ppn...p","P...NP.P","..PP..P.","...nP...",".NRK.BR."],"t":"Gr","h":["Rs","Ys","Gs","Rr"]},
    {"id":"p10","g":"empty","n":1,"d":1,"b":["r....br.","p.qk.N.p","nppB.np.","........",".P.p..b.","N.......","P.P.PP.P","..RQKB.R"],"t":"Yn","h":["Rn","Rs","Ys"]},
    {"id":"p11","g":"empty","n":1,"d":1,"b":[".rbqkb.r","pppppppp","..n.....","........",".P.P..n.","N.P..P.N","P...P.PP","R.BQKB.R"],"t":"Yr","h":["Bp","Ys","Rs","Bs"]},
    {"id":"p12","g":"king","n":1,"d":2,"b":["..bqkb.r","rpNpppp.","p.n.....",".......p","P..P...P","....K..R",".PP.PPP.","R.BQ.BN."],"t":"Rk","h":["Rs","Gn","Gk","Yk","Gs"]},
    {"id":"p13","g":"king","n":1,"d":2,"b":["r.q..b..","pppbpp.p","...kr...","...nn.p.","....N...","PP...P.P","..PPP.PR","R.BQKB.."],"t":"Bb","h":["Gq","Rn","Rs","Gb","Ys","Bs"]},
    {"id":"p14","g":"empty","n":1,"d":2,"b":["rnb.k..r",".p.p..pp","p.p....n","....pp..","Pq......",".....PPB","RP.PP..P",".NB.QKNR"],"t":"Gb","h":["Bs","Ys","Rs","Rb","Gs"]},
    {"id":"p15","g":"king","n":1,"d":2,"b":["r......r","p..k.ppp","....p.bn","....N...","P...Pb..","...P....",".PP.KPPP","R..Q.B.R"],"t":"Bk","h":["Ys","Ys","Bb","Gb","Yn","Bs"]},
    {"id":"p16","g":"king","n":1,"d":2,"b":[".rbq.bnr",".ppkp...",".....ppp","...p....","p..P..Q.","N...P.P.","PPPB.P.P","R...K.NR"],"t":"Rk","h":["Ys","Yq","Bs","Rs","Gk","Bb"]},
    {"id":"p17","g":"empty","n":1,"d":2,"b":["r.bk..nr","p.pp.pp.","..pbp...",".......p","P......q","..N.P...",".PPP.PPP",".RBQK.NR"],"t":"Yp","h":["Gs","Rs","Bs","Rp","Ys"]},
    {"id":"p18","g":"king","n":1,"d":2,"b":["rn.qkbnr","pppBpppp","...p....","........","P...P..P",".....N..",".PPP.PP.","RNBQK..R"],"t":"Bk","h":["Rr","Gb","Gs","Bs","Rs","Rr"]},
    {"id":"p19","g":"king","n":1,"d":2,"b":["r.bq.kr.","ppppnppN","..n.....","........",".......P","P....P.R",".PPQKPP.","R.B..B.."],"t":"Gk","h":["Br","Ys","Rd","Yn","Gs"]},
    {"id":"p20","g":"empty","n":1,"d":2,"b":["r..qkbnr","p.p.pppp","n.......",".p......",".....Pb.",".....N..","PPPpP..P",".RBQKB.R"],"t":"Rp","h":["Rs","Ys","Yb","Bs","Gs"]},
    {"id":"p21","g":"king","n":2,"d":3,"b":[".rbq...r","..ppbkpp","....p..n",".p......",".n.PNP..",".Q.K....","R.PBP.PP",".....BR."],"t":"Yn","h":["Yq","Rs","Bq"]},
    {"id":"p22","g":"king","n":2,"d":3,"b":["r.b.q.n.","p..ppkbr","..p..p.p","........",".p.nNBp.","....PP..","PPP...PP","RQK..BNR"],"t":"Rr","h":["Rb","Rd","Bb"]},
    {"id":"p23","g":"king","n":2,"d":3,"b":[".nb..kr.","rp.p...p",".b.....n","pP..Nppq","........",".......P","RPPPPPP.","..BQKB.R"],"t":"Bq","h":["Bn","Yn","Yr"]},
    {"id":"p24","g":"king","n":2,"d":3,"b":[".nb.kb.r",".p.pp.p.",".....p.p","Q...q...",".P...r..","......RP","P..PP.B.",".RB.K..."],"t":"Yn","h":["Rr","Rq","Yp","Yq"]},
    {"id":"p25","g":"king","n":2,"d":3,"b":[".....b..","p.pkpbpr","..Nq...n",".p.p...p","...P.p.P","P...K.P.","..QBPP.R","RN...B.."],"t":"Rp","h":["Yq","Gq","Rb","Rq"]},
    {"id":"p26","g":"king","n":2,"d":3,"b":[".n.Bk.nr",".pp..pRp","r...b...","p..p...P",".b.Pp...","..N....N","PPP.PPP.","R..QKB.."],"t":"Gn","h":["Yr","Gr","Rr"]},
    {"id":"p27","g":"king","n":2,"d":3,"b":["rqnk.b..",".bpppppr","........","pp...P..","....P..p","N.Q.K..N","PPPBP.PP","R....B.R"],"t":"Yp","h":["Yq","Gq","Rs"]},
    {"id":"p28","g":"king","n":2,"d":3,"b":["rnbqkb.r","p..p..pp","..p.....",".p.npp..",".......P",".....BP.","PPPPPP..","RNBQK.NR"],"t":"Gr","h":["Yb","Gb","Yd"]},
    {"id":"p29","g":"king","n":2,"d":3,"b":[".r...q.r","nbpp.p..","p....k.n",".p.p...p",".....P..","N.P....P","PPQKR.P.",".....B.R"],"t":"Rq","h":["Rr","Rd","Yn","Gr"]},
    {"id":"p30","g":"king","n":2,"d":3,"b":[".n.qkb.r","...pnppp",".p....r.","pbp.p...","P..P...P","....PQP.",".PP..PB.","R.B..KNR"],"t":"Rp","h":["Rb","Rq","Rn","Bq"]},
    {"id":"p31","g":"king","n":2,"d":3,"b":[".nbq.b.r","rp.pp.p.","p....k.p","..p...RP","..P..Pp.","P..KP...",".PQPB.P.","RNB....."],"t":"Yb","h":["Gs","Bq","Bp","Yq"]},
    {"id":"p32","g":"king","n":2,"d":3,"b":["rnbqk...","pppp...p",".....prn","b..Np.p.","..P....P",".P.....N","PB.PPPP.","..RQKB.R"],"t":"Yq","h":["Yn","Rr","Gn"]},
  ];

  // ---------- oyun içi akış ----------
  const K_SOLVED = 'sahkart-puzzles';
  let cur = null, idx = -1, turnsLeft = 0, state = 'play', hintStep = 0;
  const solved = () => { try { return new Set(JSON.parse(localStorage.getItem(K_SOLVED)) || []); } catch (_) { return new Set(); } };
  const markSolved = id => { const s = solved(); s.add(id); localStorage.setItem(K_SOLVED, JSON.stringify([...s])); };
  const dailyIndex = () => Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 864e5) % LIST.length;

  function load(i) {
    idx = i; cur = LIST[i];
    turnsLeft = cur.n; state = 'play'; hintStep = 0;
    S = stateOf(cur);
    Core.log(S, 'puzzle', { n: i + 1 });
    afterChange();
  }

  // Oyuncu bir kart oynadıktan sonra: kazandı mı, tur bitti mi, sıkıştı mı?
  function after() {
    if (!cur || state !== 'play') return;
    if (S.over) {
      if (S.winner === 0 && S.reason === cur.g) { state = 'won'; markSolved(cur.id); Analytics.track('puzzle_solved', { id: cur.id, hints: hintStep }); }
      else state = 'lost';
      return render();
    }
    if (S.turn === 1) {
      turnsLeft--;
      if (turnsLeft <= 0) { state = 'lost'; return render(); }
      // Rakip oynayamaz ve pas geçer; sıra yeniden sende
      setTimeout(() => {
        if (!cur || state !== 'play') return;
        Core.log(S, 'oppPass', {}, 1);
        S.turn = 0;
        Core.startTurn(S);
        afterChange();
        stuckCheck();
      }, 700);
      return render();
    }
    stuckCheck();
    render();
  }
  function stuckCheck() {
    if (state === 'play' && S.turn === 0 && !S.over && !Core.optionsFor(S, 0).length) { state = 'lost'; render(); }
  }

  // İpucu: önce doğru kartı, ikinci basışta hangi taşın oynayacağını göster
  let hintCache = { key: '', line: null };
  function hint() {
    if (!cur || state !== 'play' || !hintStep || S.turn !== 0) return {};
    const key = cur.id + ':' + S.log.length + ':' + turnsLeft;
    if (hintCache.key !== key) hintCache = { key, line: solve(structuredClone(S), cur.g, turnsLeft, 1).lines[0] || null };
    const line = hintCache.line;
    if (!line) return {};
    const a = line[0];
    const h = { card: a.cardId, squares: new Set() };
    if (hintStep > 1 && a.move) h.squares.add(a.move.fr * 8 + a.move.fc);
    return h;
  }
  function askHint() { hintStep++; Analytics.track('puzzle_hint', { id: cur.id, step: hintStep }); render(); }

  function renderCoach() {
    if (!cur) return;
    const stars = '★'.repeat(cur.d) + '☆'.repeat(3 - cur.d);
    $('#coach-step').textContent = t('pz.title', { n: idx + 1, stars });
    const goal = t('pz.goal.' + cur.g + (cur.n > 1 ? '.n' : ''), { n: cur.n });
    let text = goal;
    if (state === 'play') text += '<br><span class="pz-turns">' + t('pz.turnsLeft', { n: turnsLeft }) + '</span>' + (cur.n > 1 ? ' · ' + t('pz.oppPasses') : '');
    if (state === 'won') text = '<b>' + t('pz.won') + '</b> ' + goal;
    if (state === 'lost') text = '<b>' + t('pz.lost') + '</b> ' + goal;
    $('#coach-text').innerHTML = text;
    $('#coach').classList.toggle('done', state === 'won');
    $('#coach').classList.toggle('fail', state === 'lost');
    $('#coach-next').classList.toggle('hidden', state !== 'won');
    $('#coach-next').textContent = idx < LIST.length - 1 ? t('pz.next') : t('pz.list');
    $('#coach-retry').classList.remove('hidden');
    $('#coach-hint').classList.toggle('hidden', state !== 'play');
    const done = solved();
    $('#coach-dots').innerHTML = '<span class="pz-count">' + t('pz.progress', { n: done.size, total: LIST.length }) + '</span>';
  }

  function next() { if (idx < LIST.length - 1) load(idx + 1); else showPuzzleList(); }
  function stop() { cur = null; idx = -1; }
  function retry() { Analytics.track('puzzle_retry', { id: cur.id }); load(idx); }

  return {
    LIST, solve, stateOf, load, after, hint, askHint, renderCoach, next, retry, stop, solved, dailyIndex,
    get hintStep() { return hintStep; }, get current() { return cur; }, get index() { return idx; },
    get active() { return state === 'play'; },
  };
})();
