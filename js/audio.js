(function (root) {
  const Q = (root.Q = root.Q || {});

  const STRIDE = 3.2; // metri per falcata
  // Galoppo a 4 tempi: intervalli tra gli appoggi in frazioni di falcata; l'ultimo include la sospensione
  const GALLOP_GAPS = [0.13, 0.13, 0.14, 0.6];
  const GALLOP_ACCENT = [0.7, 0.8, 0.85, 1];
  const LOOKAHEAD = 0.12;

  // Sedicesimi a 100 bpm. X = grancassa + rullante con flam, B/b = grancassa forte/piano, S = rullante con flam, s = rullante piano
  const DRUM_STEP = 60 / 100 / 4;
  const DRUM_PATTERN = 'X..sS.s.b.s.S...' + 'X..sS.s.b.ssS.ss';

  // Le chiarine sono trombe naturali: suonano solo le armoniche di una fondamentale (Re2)
  const CHIARINA_F0 = 146.83;
  const FANFARA_RITMO = [
    [0, 0.11], [0.12, 0.11], [0.24, 0.11], [0.36, 0.44],
    [0.84, 0.11], [0.96, 0.11], [1.08, 0.11], [1.2, 0.44],
    [1.68, 0.11], [1.8, 0.11], [1.92, 0.11], [2.04, 1.5],
  ];
  // Armonica di ogni nota per ciascuna chiarina: le note lunghe si aprono a triade, la chiusura è Re-Fa#-La
  const FANFARA_VOCI = [
    { harm: [3, 3, 3, 4, 3, 4, 5, 6, 4, 5, 6, 8], detune: 0, delay: 0, pan: 0 },
    { harm: [3, 3, 3, 3, 3, 4, 5, 5, 4, 5, 6, 6], detune: -7, delay: 0.009, pan: -0.45 },
    { harm: [3, 3, 3, 2, 3, 4, 5, 4, 4, 5, 6, 5], detune: 6, delay: 0.016, pan: 0.45 },
  ];

  const BELL = [[1, 1], [2.02, 0.55], [2.76, 0.4], [4.07, 0.25], [5.4, 0.15]];

  const noiseCache = new WeakMap();
  const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const jitter = (a) => (Math.random() - 0.5) * a;

  function noiseBuffer(ctx) {
    let b = noiseCache.get(ctx);
    if (!b) {
      b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache.set(ctx, b);
    }
    return b;
  }

  function noiseSrc(ctx, when, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    s.loop = true;
    s.start(when, Math.random() * 1.5);
    if (dur) s.stop(when + dur);
    return s;
  }

  function osc(ctx, type, freq) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  function filter(ctx, type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  function gain(ctx, v) {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  }

  // Inviluppo percussivo: attacco lineare da 0 (niente click), decadimento esponenziale fino a -80 dB
  function perc(param, when, peak, attack, decay) {
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(peak, when + attack);
    param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  function send(bus, node) {
    node.connect(bus.dry);
    node.connect(bus.wet);
  }

  // Sorgente con inviluppo percussivo verso il bus; la sorgente si ferma a fine inviluppo
  function shot(bus, src, when, peak, attack, decay, through) {
    const g = gain(bus.ctx, 0);
    perc(g.gain, when, peak, attack, decay);
    (through ? src.connect(through) : src).connect(g);
    send(bus, g);
    if (src.frequency) src.start(when);
    src.stop(when + attack + decay + 0.02);
  }

  function sweep(ctx, type, from, to, when, time) {
    const o = osc(ctx, type, from);
    o.frequency.setValueAtTime(from, when);
    o.frequency.exponentialRampToValueAtTime(to, when + time);
    return o;
  }

  function impulse(ctx, secs) {
    const len = Math.floor(ctx.sampleRate * secs);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += 0.35 * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.pow(1 - i / len, 3);
      }
    }
    return b;
  }

  // Mix: bus (dry + mandata al riverbero di piazza) -> compressore -> volume generale -> uscita
  function createGraph(ctx) {
    const mix = gain(ctx, 1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const master = gain(ctx, 0.8);
    mix.connect(comp).connect(master).connect(ctx.destination);

    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx, 1.8);
    const revIn = gain(ctx, 1);
    revIn.connect(rev).connect(mix);

    const bus = (dry, wet) => {
      const d = gain(ctx, dry);
      const w = gain(ctx, wet);
      d.connect(mix);
      w.connect(revIn);
      return { ctx, dry: d, wet: w };
    };
    return { ctx, master, comp, music: bus(0.75, 0.3), sfx: bus(1, 0.1), ambient: bus(0.9, 0.15) };
  }

  // Zoccolo sulla sabbia: tonfo grave smorzato, poco attacco
  function hoof(bus, when, vel) {
    const ctx = bus.ctx;
    shot(bus, noiseSrc(ctx, when), when, 0.65 * vel, 0.003, 0.08, filter(ctx, 'lowpass', 380 + 320 * vel, 0.7));
    shot(bus, sweep(ctx, 'sine', 120, 48, when, 0.08), when, 0.5 * vel, 0.002, 0.1);
  }

  // Programma gli appoggi entro LOOKAHEAD; s = { next, beat }. Restituisce quanti appoggi ha programmato.
  function scheduleGallop(bus, s, now, speed) {
    if (!(speed > 0.3)) {
      s.next = 0;
      return 0;
    }
    const v = Math.min(speed, 20);
    const period = STRIDE / v;
    const vel = Math.min(1, 0.35 + v / 14);
    if (s.next < now) s.next = now + 0.01; // partenza o ripresa dopo uno stallo: niente raffica di colpi arretrati
    let n = 0;
    while (s.next < now + LOOKAHEAD) {
      hoof(bus, s.next + Math.random() * 0.006,vel * GALLOP_ACCENT[s.beat] * (0.9 + Math.random() * 0.2));
      s.next += period * GALLOP_GAPS[s.beat];
      s.beat = (s.beat + 1) % GALLOP_GAPS.length;
      n++;
    }
    return n;
  }

  // Tamburo imperiale: pelle grande, colpo grave con caduta di intonazione
  function kick(bus, when, vel) {
    const ctx = bus.ctx;
    shot(bus, sweep(ctx, 'sine', 95, 52, when, 0.18), when, vel, 0.004, 0.7);
    shot(bus, osc(ctx, 'triangle', 143), when, 0.22 * vel, 0.003, 0.25);
    shot(bus, noiseSrc(ctx, when), when, 0.3 * vel, 0.002, 0.05, filter(ctx, 'lowpass', 1200, 0.7));
  }

  // Tamburo a corde: cordiera (rumore) + pelle
  function snare(bus, when, vel) {
    const ctx = bus.ctx;
    shot(bus, noiseSrc(ctx, when), when, 0.5 * vel, 0.002, 0.17, filter(ctx, 'bandpass', 2600, 0.7));
    shot(bus, sweep(ctx, 'triangle', 220, 170, when, 0.05), when, 0.4 * vel, 0.002, 0.09);
  }

  function drumStep(bus, i, when) {
    const c = DRUM_PATTERN[i % DRUM_PATTERN.length];
    const v = () => 0.9 + Math.random() * 0.2;
    if (c === 'X' || c === 'B') kick(bus, when + 0.022, v());
    if (c === 'b') kick(bus, when + 0.022 + jitter(0.008), 0.65 * v());
    if (c === 'X' || c === 'S') {
      snare(bus, when, 0.28 * v());
      snare(bus, when + 0.022, v());
    }
    if (c === 's') snare(bus, when + 0.022 + jitter(0.008), 0.42 * v());
  }

  function tamburiVoice(bus, when, steps) {
    for (let i = 0; i < steps; i++) drumStep(bus, i, when + i * DRUM_STEP);
    return steps * DRUM_STEP;
  }

  // Rullo: rumore modulato da una sega rovesciata (attacco netto, decadimento lineare) che accelera,
  // in crescendo esponenziale; chiude con un colpo pieno.
  function rullo(bus, when, dur) {
    const ctx = bus.ctx;
    const end = when + dur;
    const am = gain(ctx, 0.5);
    const lfo = osc(ctx, 'sawtooth', 11);
    lfo.frequency.setValueAtTime(11, when);
    lfo.frequency.linearRampToValueAtTime(17, end);
    lfo.connect(gain(ctx, -0.5)).connect(am.gain);
    const env = gain(ctx, 0);
    env.gain.setValueAtTime(0.03, when);
    env.gain.exponentialRampToValueAtTime(0.5, end);
    env.gain.linearRampToValueAtTime(0, end + 0.06);
    noiseSrc(ctx, when, dur + 0.1).connect(filter(ctx, 'bandpass', 2400, 0.8)).connect(am);
    const body = osc(ctx, 'triangle', 190);
    body.connect(gain(ctx, 0.35)).connect(am);
    am.connect(env);
    send(bus, env);
    lfo.start(when);
    body.start(when);
    lfo.stop(end + 0.1);
    body.stop(end + 0.1);
    kick(bus, end, 1);
    snare(bus, end, 1);
    return dur + 0.8;
  }

  function chiarina(bus, when, voce) {
    const ctx = bus.ctx;
    const o = osc(ctx, 'sawtooth', 440);
    o.detune.value = voce.detune;
    const lp = filter(ctx, 'lowpass', 1000, 1.2);
    const g = gain(ctx, 0);
    const vib = osc(ctx, 'sine', 5.6);
    const vibDepth = gain(ctx, 0);
    vib.connect(vibDepth).connect(o.frequency);
    o.connect(lp).connect(g);
    let out = g;
    if (ctx.createStereoPanner) {
      out = ctx.createStereoPanner();
      out.pan.value = voce.pan;
      g.connect(out);
    }
    send(bus, out);

    let end = when;
    FANFARA_RITMO.forEach(([t0, dur], i) => {
      const t = when + voce.delay + t0;
      const f = CHIARINA_F0 * voce.harm[i];
      const long = dur > 0.3;
      const a = 0.022;
      const r = long ? Math.min(0.25, dur * 0.3) : 0.04;
      const sus = long ? 0.145 : 0.125;
      // attacco "labiale": la nota parte calante e sale in 35 ms, il filtro si apre col fiato
      o.frequency.setValueAtTime(f * 0.97, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
      lp.frequency.setValueAtTime(f * 1.5, t);
      lp.frequency.linearRampToValueAtTime(Math.min(f * 7, 9000), t + 0.04);
      lp.frequency.linearRampToValueAtTime(Math.min(f * 4.5, 7000), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + a);
      g.gain.linearRampToValueAtTime(sus, Math.min(t + a + 0.06, t + dur - r));
      g.gain.linearRampToValueAtTime(sus, t + dur - r);
      g.gain.linearRampToValueAtTime(0, t + dur);
      if (long) {
        vibDepth.gain.setValueAtTime(0, t + 0.15);
        vibDepth.gain.linearRampToValueAtTime(f * 0.007, t + 0.4);
        vibDepth.gain.setValueAtTime(0, t + dur);
      }
      end = t + dur;
    });
    o.start(when);
    vib.start(when);
    o.stop(end + 0.05);
    vib.stop(end + 0.05);
    return end - when;
  }

  function fanfara(bus, when) {
    return Math.max(...FANFARA_VOCI.map((v) => chiarina(bus, when, v))) + 0.8;
  }

  // Brusio: rumore su tre formanti vocali che respirano a ritmi diversi, più un fondo grave.
  // Restituisce il GainNode del livello (parte da 0).
  function crowdBed(bus) {
    const ctx = bus.ctx;
    const t = ctx.currentTime;
    const level = gain(ctx, 0);
    send(bus, level);
    const n = noiseSrc(ctx, t);
    [[450, 3, 0.7, 1.3], [1100, 3.5, 1.3, 1], [2500, 4, 1.9, 0.8]].forEach(([f, q, rate, amp]) => {
      const g = gain(ctx, amp);
      const lfo = osc(ctx, 'sine', rate * (0.8 + Math.random() * 0.4));
      lfo.connect(gain(ctx, amp * 0.45)).connect(g.gain);
      lfo.start(t);
      n.connect(filter(ctx, 'bandpass', f, q)).connect(g).connect(level);
    });
    n.connect(filter(ctx, 'lowpass', 300, 0.7)).connect(gain(ctx, 0.9)).connect(level);
    return level;
  }

  function cheer(bus, when, k) {
    const ctx = bus.ctx;
    const dur = 2.2 + 2 * k;
    const peak = 0.25 + 0.45 * k;
    const env = gain(ctx, 0);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + 0.45);
    env.gain.linearRampToValueAtTime(peak * 0.8, when + dur * 0.45);
    env.gain.linearRampToValueAtTime(0, when + dur);
    send(bus, env);

    const bp = filter(ctx, 'bandpass', 600, 0.7);
    bp.frequency.setValueAtTime(600, when);
    bp.frequency.linearRampToValueAtTime(1300, when + 0.5);
    bp.frequency.linearRampToValueAtTime(800, when + dur);
    noiseSrc(ctx, when, dur).connect(bp).connect(gain(ctx, 1.4)).connect(env);

    // voci: seghe scordate che salgono insieme all'urlo
    const vlp = filter(ctx, 'lowpass', 1600, 0.5);
    vlp.connect(gain(ctx, 0.05)).connect(env);
    for (let i = 0; i < 8; i++) {
      const f = 190 + Math.random() * 260;
      const o = osc(ctx, 'sawtooth', f);
      o.frequency.setValueAtTime(f, when);
      o.frequency.linearRampToValueAtTime(f * (1.15 + Math.random() * 0.15), when + 0.5);
      o.frequency.linearRampToValueAtTime(f * 0.95, when + dur);
      o.connect(vlp);
      o.start(when + Math.random() * 0.15);
      o.stop(when + dur);
    }

    if (k > 0.6) {
      const w = osc(ctx, 'sine', 2000);
      const t = when + 0.3;
      w.frequency.setValueAtTime(2000, t);
      w.frequency.linearRampToValueAtTime(2700, t + 0.15);
      w.frequency.linearRampToValueAtTime(2200, t + 0.6);
      const wg = gain(ctx, 0);
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(0.035, t + 0.05);
      wg.gain.linearRampToValueAtTime(0, t + 0.6);
      w.connect(wg);
      send(bus, wg);
      w.start(t);
      w.stop(t + 0.65);
    }
    return dur;
  }

  // "Ooooh" di delusione: voci su vocale scura che calano di intonazione
  function ooh(bus, when) {
    const ctx = bus.ctx;
    const dur = 1.8;
    const env = gain(ctx, 0);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(0.35, when + 0.25);
    env.gain.linearRampToValueAtTime(0.25, when + 0.9);
    env.gain.linearRampToValueAtTime(0, when + dur);
    send(bus, env);
    const lp = filter(ctx, 'lowpass', 650, 0.8);
    lp.connect(gain(ctx, 0.12)).connect(env);
    for (let i = 0; i < 8; i++) {
      const f = 240 + Math.random() * 120;
      const o = osc(ctx, 'sawtooth', f);
      o.frequency.setValueAtTime(f, when);
      o.frequency.linearRampToValueAtTime(f * 1.05, when + 0.25);
      o.frequency.linearRampToValueAtTime(f * 0.72, when + dur);
      o.connect(lp);
      o.start(when + Math.random() * 0.1);
      o.stop(when + dur);
    }
    noiseSrc(ctx, when, dur).connect(filter(ctx, 'lowpass', 500, 0.7)).connect(gain(ctx, 0.5)).connect(env);
    return dur;
  }

  function bell(bus, when, v) {
    const ctx = bus.ctx;
    BELL.forEach(([ratio, amp]) => {
      shot(bus, osc(ctx, 'sine', 1318.5 * ratio), when, 0.1 * v * amp, 0.002, 1.4 / Math.sqrt(ratio));
    });
  }

  // Lancia sullo scudo: transitorio di legno, due modi di risonanza, tonfo dello scudo
  function hit(bus, when, points) {
    const ctx = bus.ctx;
    const v = 0.6 + 0.4 * clamp01(points / 100);
    shot(bus, noiseSrc(ctx, when), when, 0.9 * v, 0.001, 0.035, filter(ctx, 'bandpass', 1900, 1.8));
    shot(bus, osc(ctx, 'triangle', 610), when, 0.3 * v, 0.001, 0.07);
    shot(bus, osc(ctx, 'sine', 260), when, 0.4 * v, 0.002, 0.14);
    shot(bus, sweep(ctx, 'sine', 95, 70, when, 0.15), when, 0.45 * v, 0.003, 0.18);
    if (points >= 100) {
      bell(bus, when + 0.04, 1);
      bell(bus, when + 0.22, 0.7);
      return 1.8;
    }
    return 0.3;
  }

  function penalty(bus, when) {
    const ctx = bus.ctx;
    shot(bus, sweep(ctx, 'sine', 80, 38, when, 0.3), when, 0.8, 0.005, 0.45);
    shot(bus, noiseSrc(ctx, when), when, 0.6, 0.004, 0.3, filter(ctx, 'lowpass', 220, 0.7));
    return 0.6;
  }

  let G = null;
  let crowdLevel = null;
  let crowdTarget = 0;
  let masterLevel = 0.8;
  let drumTimer = 0;
  let drumNext = 0;
  let drumIdx = 0;
  const gal = { next: 0, beat: 0 };

  function drumTick() {
    const now = G.ctx.currentTime;
    if (drumNext < now) drumNext = now + 0.02;
    while (drumNext < now + LOOKAHEAD + 0.08) {
      drumStep(G.music, drumIdx, drumNext);
      drumIdx = (drumIdx + 1) % DRUM_PATTERN.length;
      drumNext += DRUM_STEP;
    }
  }

  Q.Audio = {
    // Restituisce false se il browser non ha WebAudio: le altre funzioni restano senza effetto
    init() {
      if (G) return true;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      G = createGraph(new AC());
      G.master.gain.value = masterLevel;
      crowdLevel = crowdBed(G.ambient);
      if (G.ctx.state === 'suspended') G.ctx.resume();
      return true;
    },

    // Il valore impostato prima di init() viene applicato all'avvio
    setMaster(v) {
      masterLevel = clamp01(v);
      if (G) G.master.gain.setTargetAtTime(masterLevel, G.ctx.currentTime, 0.02);
    },

    suspend() {
      return G ? G.ctx.suspend() : Promise.resolve();
    },

    resume() {
      return G ? G.ctx.resume() : Promise.resolve();
    },

    gallop(speed) {
      if (G) scheduleGallop(G.sfx, gal, G.ctx.currentTime, speed);
    },

    crowd(level) {
      if (!G) return;
      const target = clamp01(level) * 0.35;
      // chiamabile a ogni frame: aggiorna l'automazione solo se il livello cambia davvero
      if (Math.abs(target - crowdTarget) < 0.005) return;
      crowdTarget = target;
      crowdLevel.gain.setTargetAtTime(target, G.ctx.currentTime, 0.4);
    },

    cheer(intensity) {
      if (G) cheer(G.ambient, G.ctx.currentTime, clamp01(intensity));
    },

    ooh() {
      if (G) ooh(G.ambient, G.ctx.currentTime);
    },

    hit(points) {
      if (G) hit(G.sfx, G.ctx.currentTime, Number(points) || 0);
    },

    penalty() {
      if (G) penalty(G.sfx, G.ctx.currentTime);
    },

    tamburi(on) {
      if (!G) return;
      if (on && !drumTimer) {
        drumIdx = 0;
        drumNext = G.ctx.currentTime + 0.05;
        drumTick();
        drumTimer = root.setInterval(drumTick, 40);
      } else if (!on && drumTimer) {
        root.clearInterval(drumTimer);
        drumTimer = 0;
      }
    },

    rullo(durata) {
      if (G) rullo(G.music, G.ctx.currentTime + 0.02, Math.min(12, Math.max(0.3, Number(durata) || 2)));
    },

    fanfara() {
      if (G) fanfara(G.music, G.ctx.currentTime + 0.02);
    },

    // Per test e render offline: ogni voce è (bus, when, ...) con bus = createGraph(ctx).music/sfx/ambient
    // e restituisce la durata in secondi; gallop(bus, stato, now, speed) è lo scheduler a frame.
    createGraph,
    voices: {
      gallop: scheduleGallop,
      tamburi: tamburiVoice,
      rullo,
      fanfara,
      crowdBed,
      cheer,
      ooh,
      hit,
      penalty,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
