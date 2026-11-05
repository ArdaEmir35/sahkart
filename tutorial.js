// Şahkart etkileşimli eğitim: hazır pozisyonlarda adım adım dersler
const Tutorial = (() => {
  const RED = 0, BLUE = 1, GREEN = 2, YELLOW = 3;
  let id = 90000;
  const C = (kind, color, piece) => ({ id: id++, kind, color, piece });
  const P = (color, piece) => C('piece', color, piece);
  // Kartı renkli bir etiket olarak göster: "♟ Kırmızı Piyon"
  const tag = card => '<span class="tag ' + (card.kind === 'wild' ? 'wild' : 'c' + card.color) + '">'
    + (card.kind === 'draw2' ? '' : cardSymbol(card) + ' ') + R.cardLabel(card) + '</span>';

  // Tahta: 8. sıradan 1. sıraya, büyük harf beyaz, küçük harf siyah
  function boardFrom(rows) {
    return rows.map(row => [...row].map(ch => (ch === '.' ? null : { t: ch.toLowerCase(), w: ch === ch.toUpperCase() })));
  }
  const START = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'];
  const sq = name => [8 - +name[1], 'abcdefgh'.indexOf(name[0])];
  const playOf = (a, kind) => a.type === 'play' && (!kind || a.opt.card.kind === kind);

  // Her ders: başlangıç durumu ve sırayla yapılacak adımlar
  const LESSONS = [
    () => {
      const top = P(RED, 'p'), good = P(BLUE, 'p');
      return {
        title: 'Kart eşleştirme', board: START, top, active: RED,
        hand: [good, P(GREEN, 'n'), P(YELLOW, 'q'), P(YELLOW, 'b')],
        steps: [{
          text: `Hamle yapmak için kart oynarsın. Kart, ortadaki kartla <b>aynı renkte</b> ya da <b>aynı sembolde</b> olmalı.<br>Ortada ${tag(top)} var. Elindeki ${tag(good)} sembolü tuttuğu için parlıyor. Ona tıkla, sonra bir piyonunu seçip ileri sür.`,
          hint: { card: good },
          check: a => (playOf(a) ? null : 'Mavi Piyon kartını oyna.'),
        }],
        done: 'Harika! Kartın üzerindeki taş, hangi taşını oynatacağını belirler. Geçerli renk artık <b>Mavi</b> oldu.',
      };
    },
    () => {
      const top = P(BLUE, 'p'), good = P(BLUE, 'n');
      return {
        title: 'Renk bonusu', board: START, top, active: BLUE,
        hand: [good, P(RED, 'b'), P(YELLOW, 'r')],
        steps: [{
          text: `Tahtanın sütunları renklidir: <span class="zc0">a–b kırmızı</span>, <span class="zc1">c–d mavi</span>, <span class="zc2">e–f yeşil</span>, <span class="zc3">g–h sarı</span>.<br>Taşını <b>kartın rengindeki şeride</b> götürürsen rakip 1 kart çeker! ${tag(good)} kartını oyna ve b1'deki atını <b>c3</b>'e götür.`,
          hint: { card: good, squares: ['b1', 'c3'] },
          check: a => (a.type === 'play' && R.zoneBonus(a.opt.card, a.opt.move) ? null
            : 'Bonus için atı mavi şeride (c veya d sütunu) götür: b1 → c3.'),
        }],
        done: '<b>Renk bonusu!</b> Rakip 1 kart çekti. Elindeki kartları bitiren de kazanır, bu yüzden rakibe kart çektirmek çok değerli.',
      };
    },
    () => {
      const top = P(YELLOW, 'n'), skip = C('skip', YELLOW), d2 = C('draw2', YELLOW);
      return {
        title: 'Atla ve +2', board: START, top, active: YELLOW,
        hand: [skip, d2, P(RED, 'p')],
        steps: [
          {
            text: `${tag(skip)} kartı rakibin sırasını atlatır, <b>sen tekrar oynarsın</b>. Onu oyna.`,
            hint: { card: skip },
            check: a => (playOf(a, 'skip') ? null : 'Önce Atla kartını oyna.'),
          },
          {
            text: `Sıra hâlâ sende! Şimdi ${tag(d2)} kartını oyna: rakip 2 kart çeker.`,
            hint: { card: d2 },
            check: a => (playOf(a, 'draw2') ? null : '+2 kartını oyna.'),
          },
        ],
        done: 'Rakip 2 kart çekti. Atla ve +2 kartları, özellikle rakibin az kartı kaldığında çok güçlüdür.',
      };
    },
    () => {
      const top = P(BLUE, 'b'), joker = C('wild', null);
      const board = ['r.bqkbnr', 'pppppppp', '........', '........', '........', '..n.....', 'PPPPPPPP', 'RNBQKBNR'];
      return {
        title: 'Joker', board, top, active: BLUE,
        hand: [joker, P(YELLOW, 'r')],
        steps: [{
          text: `${tag(joker)} her zaman oynanabilir ve <b>istediğin taşı</b> oynatır. Sonra yeni rengi sen seçersin.<br>Rakibin atı c3'e kadar gelmiş! Jokeri seç ve b2 ya da d2 piyonunla atı al.`,
          hint: { card: joker, squares: ['c3'] },
          check: a => {
            const [r, c] = sq('c3');
            return a.type === 'play' && a.opt.move && a.opt.move.tr === r && a.opt.move.tc === c ? null : 'c3\'teki atı al: b2 ya da d2 piyonunu seç.';
          },
        }],
        done: 'Atı aldın ve rengi sen belirledin. Jokeri zor anlar için saklamak genelde iyi bir fikirdir.',
      };
    },
    () => {
      const top = P(GREEN, 'r'), drawn = P(GREEN, 'p');
      return {
        title: 'Kart çekme', board: START, top, active: GREEN,
        hand: [P(RED, 'n'), P(BLUE, 'b')], deck: [P(RED, 'k'), P(BLUE, 'q'), drawn],
        steps: [
          {
            text: 'Elindeki kartların hiçbiri ortadaki kartla eşleşmiyor. <b>Kart çek</b> düğmesine (desteye) tıklayıp 1 kart çek.',
            hint: { deck: true },
            check: a => (a.type === 'draw' ? null : 'Desteden kart çek.'),
          },
          {
            text: `Çektiğin ${tag(drawn)} oynanabiliyor, hemen oynayabilirsin! Bir piyonunu ileri sür.`,
            hint: { card: drawn },
            check: a => (playOf(a) ? null : 'Çektiğin Yeşil Piyon kartını oyna.'),
          },
        ],
        done: 'Çektiğin kart oynanamasaydı sıra rakibe geçerdi. İstersen oynayabileceğin bir kart varken de kart çekebilirsin.',
      };
    },
    () => {
      const top = P(RED, 'p'), queen = P(RED, 'q');
      const board = ['rnb.kbnr', 'ppppp.pp', '........', '.......Q', '....P...', '........', 'PPPP.PPP', 'RNB.KBNR'];
      return {
        title: 'Şahı al', board, top, active: RED,
        hand: [queen, P(BLUE, 'n')],
        steps: [{
          text: `Şahkart'ta <b>şah çekme kuralı yoktur</b>: rakibin şahını alırsan oyunu hemen kazanırsın!<br>Vezirin h5'te ve siyah şah korumasız. ${tag(queen)} kartını oyna ve <b>e8</b>'deki şahı al.`,
          hint: { card: queen, squares: ['h5', 'e8'] },
          check: a => {
            const m = a.type === 'play' && a.opt.move;
            return m && S.board[m.tr][m.tc] && S.board[m.tr][m.tc].t === 'k' ? null : 'Vezirle e8\'deki şahı al.';
          },
        }],
        done: '<b>Kazandın!</b> Aynı şey senin şahının da başına gelebilir, onu korumasız bırakma. Elindeki <b>tüm kartları bitirmek</b> de oyunu kazandırır.',
      };
    },
  ];

  let lesson = null, index = 0, step = 0, finished = false;

  function load(i) {
    index = i; step = 0; finished = false;
    lesson = LESSONS[i]();
    const opp = Array.from({ length: 5 }, () => P(RED, 'p'));
    S = {
      board: boardFrom(lesson.board), deck: lesson.deck || [P(RED, 'p'), P(BLUE, 'n')],
      discard: [lesson.top], hands: [lesson.hand, opp],
      activeColor: lesson.active, turn: 0, over: false, winner: null, reason: '',
      lastMove: null, drawn: null, log: [],
      gameId: 'tut' + i + '-' + Math.random().toString(36).slice(2, 6), moveNo: 0, sfx: [], sfxN: 0, clock: null,
    };
    log('Ders ' + (i + 1) + ': ' + lesson.title);
    startTurn();
  }

  function start() { load(0); }

  // Oyuncunun eylemi adım için doğru mu? Değilse ipucu mesajı döner.
  function check(action) {
    if (!lesson || finished) return 'Devam etmek için "Devam" düğmesine bas.';
    return lesson.steps[step].check(action);
  }

  function advance() {
    step++;
    if (step >= lesson.steps.length) {
      finished = true;
      if (index === LESSONS.length - 1) localStorage.setItem('sahkart-tutorial', 'done');
    }
    render();
  }

  function hint() {
    if (!lesson || finished) return {};
    const h = lesson.steps[step].hint || {};
    return { card: h.card && h.card.id, deck: h.deck, squares: new Set((h.squares || []).map(n => { const [r, c] = sq(n); return r * 8 + c; })) };
  }

  function renderCoach() {
    const box = document.querySelector('#coach');
    if (!lesson) return;
    const last = index === LESSONS.length - 1;
    document.querySelector('#coach-step').textContent = 'Ders ' + (index + 1) + '/' + LESSONS.length + ' · ' + lesson.title;
    document.querySelector('#coach-text').innerHTML = finished ? lesson.done : lesson.steps[step].text;
    box.classList.toggle('done', finished);
    const next = document.querySelector('#coach-next');
    next.classList.toggle('hidden', !finished);
    next.textContent = last ? 'Bota karşı oyna 🤖' : 'Devam →';
    document.querySelector('#coach-dots').innerHTML = LESSONS.map((_, i) =>
      '<span class="' + (i < index || (i === index && finished) ? 'ok' : i === index ? 'cur' : '') + '"></span>').join('');
  }

  function next() {
    if (index < LESSONS.length - 1) return load(index + 1);
    lesson = null;
    botLevel = 'easy';
    localStorage.setItem('sahkart-level', botLevel);
    showLevel();
    startBotGame();
  }

  const isDone = () => localStorage.getItem('sahkart-tutorial') === 'done';

  return { start, check, advance, hint, renderCoach, next, isDone };
})();
