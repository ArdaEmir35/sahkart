// Etkileşimli eğitim: hazır pozisyonlarda adım adım dersler (metinler i18n.js'te: tut.N.*)
const Tutorial = (() => {
  const RED = 0, BLUE = 1, GREEN = 2, YELLOW = 3;
  let id = 90000;
  const C = (kind, color, piece) => ({ id: id++, kind, color, piece });
  const P = (color, piece) => C('piece', color, piece);
  // Kartı renkli bir etiket olarak göster: "♟ Red Pawn"
  const tag = card => '<span class="tag ' + (card.kind === 'wild' ? 'wild' : 'c' + card.color) + '">'
    + (card.kind === 'draw2' ? '' : cardSymbol(card) + ' ') + cardLabel(card) + '</span>';

  // Tahta: 8. sıradan 1. sıraya, büyük harf beyaz, küçük harf siyah
  function boardFrom(rows) {
    return rows.map(row => [...row].map(ch => (ch === '.' ? null : { t: ch.toLowerCase(), w: ch === ch.toUpperCase() })));
  }
  const START = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'];
  const sq = name => [8 - +name[1], 'abcdefgh'.indexOf(name[0])];
  const playOf = (a, kind) => a.type === 'play' && (!kind || a.opt.card.kind === kind);

  // Her ders: başlangıç durumu ve sırayla yapılacak adımlar.
  // Metinler fonksiyon: dil oyun sırasında değişse de doğru dilde gösterilir.
  const LESSONS = [
    () => {
      const top = P(RED, 'p'), good = P(BLUE, 'p');
      return {
        board: START, top, active: RED,
        hand: [good, P(GREEN, 'n'), P(YELLOW, 'q'), P(YELLOW, 'b')],
        steps: [{
          text: () => t('tut.1.s1', { top: tag(top), good: tag(good) }),
          hint: { card: good },
          check: a => (playOf(a) ? null : t('tut.1.e1')),
        }],
      };
    },
    () => {
      const top = P(BLUE, 'p'), good = P(BLUE, 'n');
      return {
        board: START, top, active: BLUE,
        hand: [good, P(RED, 'b'), P(YELLOW, 'r')],
        steps: [{
          text: () => t('tut.2.s1', { good: tag(good) }),
          hint: { card: good, squares: ['b1', 'c3'] },
          check: a => (a.type === 'play' && R.zoneBonus(a.opt.card, a.opt.move) ? null : t('tut.2.e1')),
        }],
      };
    },
    () => {
      const top = P(YELLOW, 'n'), skip = C('skip', YELLOW), d2 = C('draw2', YELLOW);
      return {
        board: START, top, active: YELLOW,
        hand: [skip, d2, P(RED, 'p')],
        steps: [
          { text: () => t('tut.3.s1', { skip: tag(skip) }), hint: { card: skip }, check: a => (playOf(a, 'skip') ? null : t('tut.3.e1')) },
          { text: () => t('tut.3.s2', { d2: tag(d2) }), hint: { card: d2 }, check: a => (playOf(a, 'draw2') ? null : t('tut.3.e2')) },
        ],
      };
    },
    () => {
      const top = P(BLUE, 'b'), joker = C('wild', null);
      return {
        board: ['r.bqkbnr', 'pppppppp', '........', '........', '........', '..n.....', 'PPPPPPPP', 'RNBQKBNR'],
        top, active: BLUE,
        hand: [joker, P(YELLOW, 'r')],
        steps: [{
          text: () => t('tut.4.s1', { joker: tag(joker) }),
          hint: { card: joker, squares: ['c3'] },
          check: a => {
            const [r, c] = sq('c3');
            return a.type === 'play' && a.opt.move && a.opt.move.tr === r && a.opt.move.tc === c ? null : t('tut.4.e1');
          },
        }],
      };
    },
    () => {
      const top = P(GREEN, 'r'), drawn = P(GREEN, 'p');
      return {
        board: START, top, active: GREEN,
        hand: [P(RED, 'n'), P(BLUE, 'b')], deck: [P(RED, 'k'), P(BLUE, 'q'), drawn],
        steps: [
          { text: () => t('tut.5.s1'), hint: { deck: true }, check: a => (a.type === 'draw' ? null : t('tut.5.e1')) },
          { text: () => t('tut.5.s2', { drawn: tag(drawn) }), hint: { card: drawn }, check: a => (playOf(a) ? null : t('tut.5.e2')) },
        ],
      };
    },
    () => {
      const top = P(RED, 'p'), queen = P(RED, 'q');
      return {
        board: ['rnb.kbnr', 'ppppp.pp', '........', '.......Q', '....P...', '........', 'PPPP.PPP', 'RNB.KBNR'],
        top, active: RED,
        hand: [queen, P(BLUE, 'n')],
        steps: [{
          text: () => t('tut.6.s1', { queen: tag(queen) }),
          hint: { card: queen, squares: ['h5', 'e8'] },
          check: a => {
            const m = a.type === 'play' && a.opt.move;
            return m && S.board[m.tr][m.tc] && S.board[m.tr][m.tc].t === 'k' ? null : t('tut.6.e1');
          },
        }],
      };
    },
  ];

  let lesson = null, index = 0, step = 0, finished = false;

  function load(i) {
    index = i; step = 0; finished = false;
    lesson = LESSONS[i]();
    S = Core.emptyState();
    S.board = boardFrom(lesson.board);
    S.deck = lesson.deck || [P(RED, 'p'), P(BLUE, 'n')];
    S.discard = [lesson.top];
    S.hands = [lesson.hand, Array.from({ length: 5 }, () => P(RED, 'p'))];
    S.activeColor = lesson.active;
    Core.log(S, 'lesson', { n: i + 1 });
    Core.startTurn(S);
    afterChange();
  }

  function start() { load(0); }

  // Oyuncunun eylemi adım için doğru mu? Değilse ipucu mesajı döner.
  function check(action) {
    if (!lesson || finished) return t('tut.continue');
    return lesson.steps[step].check(action);
  }

  function advance() {
    step++;
    if (step >= lesson.steps.length) {
      finished = true;
      Analytics.track('tutorial_lesson', { lesson: index + 1 });
      if (index === LESSONS.length - 1) {
        localStorage.setItem('sahkart-tutorial', 'done');
        Analytics.track('tutorial_done');
      }
    }
    render();
  }

  function hint() {
    if (!lesson || finished) return {};
    const h = lesson.steps[step].hint || {};
    return { card: h.card && h.card.id, deck: h.deck, squares: new Set((h.squares || []).map(n => { const [r, c] = sq(n); return r * 8 + c; })) };
  }

  function renderCoach() {
    if (!lesson) return;
    const n = index + 1;
    const last = index === LESSONS.length - 1;
    document.querySelector('#coach-step').textContent = t('coach.step', { n, total: LESSONS.length, title: t('tut.' + n + '.title') });
    document.querySelector('#coach-text').innerHTML = finished ? t('tut.' + n + '.done') : lesson.steps[step].text();
    document.querySelector('#coach').classList.toggle('done', finished);
    const next = document.querySelector('#coach-next');
    next.classList.toggle('hidden', !finished);
    next.textContent = last ? t('coach.play') : t('coach.next');
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

  return { start, check, advance, hint, renderCoach, next, isDone, get lessonNo() { return lesson ? index + 1 : 0; } };
})();
