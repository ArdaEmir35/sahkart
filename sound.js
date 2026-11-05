// Şahkart sesleri: dosya yok, hepsi Web Audio ile anında üretilir
const Sound = (() => {
  let ctx = null, noise = null;
  let muted = localStorage.getItem('sahkart-mute') === '1';

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      // 1 saniyelik beyaz gürültü (tahta/kart sesleri için)
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Tarayıcılar sesi ancak kullanıcı etkileşiminden sonra açar
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, ac, { passive: true }));

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // Filtrelenmiş gürültü patlaması
  function burst(t, { type = 'bandpass', freq = 1800, freqEnd, q = 1.2, gain = 0.5, attack = 0.002, decay = 0.06 }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    env(g, t, gain, attack, decay);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  function tone(t, { freq = 440, freqEnd, type = 'sine', gain = 0.3, attack = 0.005, decay = 0.15 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    env(g, t, gain, attack, decay);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  // Tahtaya konan taşın "tok" sesi
  function knock(t, loud = 1) {
    burst(t, { freq: 1500, q: 2.5, gain: 0.55 * loud, decay: 0.045 });
    tone(t, { freq: 230, freqEnd: 120, gain: 0.45 * loud, attack: 0.002, decay: 0.07 });
  }

  const SOUNDS = {
    move: t => knock(t),
    capture: t => {
      burst(t, { freq: 3200, q: 1.5, gain: 0.5, decay: 0.03 });
      knock(t + 0.012, 1.35);
    },
    promo: t => [523, 659, 784, 1047].forEach((f, i) => tone(t + 0.12 + i * 0.07, { freq: f, type: 'triangle', gain: 0.18, decay: 0.18 })),
    card: t => burst(t, { type: 'highpass', freq: 1200, freqEnd: 5000, q: 0.7, gain: 0.35, attack: 0.02, decay: 0.1 }),
    draw: t => burst(t, { type: 'bandpass', freq: 5000, freqEnd: 1500, q: 0.8, gain: 0.3, attack: 0.015, decay: 0.09 }),
    penalty: t => {
      tone(t, { freq: 520, type: 'triangle', gain: 0.18, decay: 0.1 });
      tone(t + 0.1, { freq: 390, type: 'triangle', gain: 0.18, decay: 0.16 });
    },
    skip: t => {
      tone(t, { freq: 660, type: 'triangle', gain: 0.16, decay: 0.08 });
      tone(t + 0.08, { freq: 880, type: 'triangle', gain: 0.16, decay: 0.12 });
    },
    start: t => [392, 523].forEach((f, i) => tone(t + i * 0.1, { freq: f, type: 'triangle', gain: 0.18, decay: 0.2 })),
    win: t => [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, { freq: f, type: 'triangle', gain: 0.22, decay: i === 3 ? 0.6 : 0.2 })),
    lose: t => [440, 392, 330, 262].forEach((f, i) => tone(t + i * 0.14, { freq: f, type: 'triangle', gain: 0.2, decay: i === 3 ? 0.6 : 0.22 })),
    tick: t => tone(t, { freq: 1100, type: 'square', gain: 0.05, attack: 0.001, decay: 0.03 }),
  };

  function play(name, delay = 0) {
    if (muted || !SOUNDS[name]) return;
    const c = ac();
    if (!c || c.state !== 'running') return;
    SOUNDS[name](c.currentTime + 0.01 + delay);
  }

  function setMuted(m) {
    muted = m;
    localStorage.setItem('sahkart-mute', m ? '1' : '0');
  }

  return { play, setMuted, isMuted: () => muted };
})();
